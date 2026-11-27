/**
 * Host half of the 豆包工作 connector.
 *
 * Registers one `llm` provider route, exposes the plugin's own JSON API on the
 * web server for the settings page, and keeps the account pool, model catalog and
 * cached credit readings in the plugin's own state file.
 *
 * The settings page is a plain loopback JSON client: every write the page
 * performs lands here, validated, and the page re-reads the snapshot it needs.
 */
import { DoubaoWorkAdapter } from './lib/adapter.mjs'
import { effectiveModels, PROVIDER, PROVIDER_NAME } from './lib/catalog.mjs'
import { importDesktop } from './lib/desktop.mjs'
import { accountIdOf } from './lib/upstream.mjs'
import { clearAllCooldowns, cooldownSnapshot } from './lib/pool.mjs'
import { invalidateReadings, menuStatus, readCheckin, readQuota } from './lib/readings.mjs'
import { createStateStore } from './lib/store.mjs'

export const name = 'dsh-doubaowork-connect'

const API_PREFIX = '/plugins/dsh-doubaowork-connect'

/**
 * Settings, read defensively from the row's `config`.
 *
 * The plugin declares no `Config` schema: it is installed from a local directory
 * and carries no dependencies, so it cannot import the schema library the
 * framework validates with. Unknown or missing fields fall back to the defaults
 * below instead of failing activation.
 */
function readConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const number = (input, fallback, min, max) => {
    const parsed = Number(input)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  }
  return {
    userDataDir: String(value.userDataDir ?? '').trim(),
    workspace: String(value.workspace ?? '').trim(),
    autoRefreshMinutes: number(value.autoRefreshMinutes, 30, 0, 1440),
    requestTimeoutSeconds: number(value.requestTimeoutSeconds, 300, 30, 1800),
  }
}

export const inject = ['llm', 'webServer']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx, rawConfig = {}) {
  const store = createStateStore()
  const logger = ctx.logger ?? console
  const config = readConfig(rawConfig)
  const settings = {
    userDataDir: () => config.userDataDir,
    workspace: () => config.workspace,
    autoRefreshMinutes: () => config.autoRefreshMinutes,
    requestTimeoutSeconds: () => config.requestTimeoutSeconds,
  }

  // --- provider route -------------------------------------------------------
  const adapter = new DoubaoWorkAdapter({ store, ctx })
  const releaseAdapter = ctx.llm.registerAdapter([PROVIDER], adapter)

  try {
    ctx.llm.registerModelDiscovery(settingsNamespace(), async (request, signal) => {
      // Deliberately not forced: the discovery path asks what the selector can
      // offer right now, and a stale-but-valid catalog answers that without a
      // full page scrape on every call.
      const status = await menuStatus(store)
      if (!status.ok) return []
      const state = await store.read()
      return effectiveModels(state)
        .filter((model) => !model.needUpgrade)
        .map((model) => ({
          id: model.key,
          name: model.name,
          contextWindow: model.window > 0 ? model.window : undefined,
        }))
    })
  } catch (error) {
    logger.warn?.('dsh-doubaowork-connect: model discovery registration failed', error)
  }

  // --- background refresh ---------------------------------------------------
  let stopped = false
  const tick = async () => {
    if (stopped) return
    const state = await store.read()
    if (!state.accounts.length) return
    try {
      await menuStatus(store)
    } catch (error) {
      logger.warn?.('dsh-doubaowork-connect: catalog refresh failed', error)
    }
  }
  const minutes = settings.autoRefreshMinutes()
  let timer
  if (minutes > 0) {
    timer = setInterval(() => { void tick() }, Math.max(1, minutes) * 60 * 1000)
    timer.unref?.()
  }
  const intervalDispose = () => { if (timer) clearInterval(timer) }
  // One immediate attempt so a fresh install has a catalog without waiting.
  void tick()

  // --- HTTP API for the settings page --------------------------------------
  const routes = []
  const register = (path, handler) => {
    routes.push(ctx.webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}${path}`,
      handler: (req, res) => guard(req, res, () => handler(req, res)),
    }))
  }

  register('/snapshot', async (req, res) => {
    if (!requireMethod(req, res, 'GET')) return
    return json(res, 200, await snapshot(store, settings))
  })

  register('/import', async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return
    const body = await readJson(req)
    const source = body?.source === 'cookie' ? 'cookie' : 'desktop'
    if (source === 'cookie') {
      const added = await addCookieAccount(store, body)
      invalidateReadings()
      return json(res, 200, { ok: true, added, accounts: await accountViews(store) })
    }
    const result = await importDesktop(settings.userDataDir() || 'auto')
    const added = []
    let updated = 0
    if (result.accounts.length) {
      await store.update((state) => {
        for (const found of result.accounts) {
          const id = accountIdOf(found)
          const existing = state.accounts.find((row) => row.id === id)
          if (existing) {
            existing.cookies = found.cookies
            existing.deviceId = found.deviceId
            existing.webId = found.webId
            existing.profile = found.profile
            updated++
            continue
          }
          state.accounts.push({
            id,
            label: labelOf(found),
            profile: found.profile,
            source: 'desktop',
            cookies: found.cookies,
            deviceId: found.deviceId,
            webId: found.webId,
            clientVersion: found.clientVersion ?? '',
            addedAt: Date.now(),
          })
          added.push(id)
        }
        // Pool members default to every imported account; a pool the user
        // emptied on purpose keeps its own membership.
        if (!state.pool.members.length) {
          state.pool.members = state.accounts.filter((row) => !row.disabled).map((row) => row.id)
        }
        if (!state.activeAccountId) state.activeAccountId = state.accounts[0]?.id ?? ''
        return state
      })
    }
    invalidateReadings()
    return json(res, 200, {
      ok: true,
      added,
      updated,
      userDataDir: result.userDataDir,
      // Each skipped profile carries its reason; the page shows them, because
      // the common failure (app-bound cookies, a locked database) is exactly the
      // case where a bare count leaves the user with nothing to act on.
      skipped: result.skipped,
    })
  })

  register('/accounts', async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return
    const body = await readJson(req)
    const action = String(body?.action ?? '')
    if (action === 'select') {
      const id = String(body?.id ?? '')
      await store.update((state) => {
        if (state.accounts.some((row) => row.id === id)) state.activeAccountId = id
        return state
      })
      invalidateReadings()
      return json(res, 200, await snapshot(store, settings))
    }
    if (action === 'remove') {
      const id = String(body?.id ?? '')
      await store.update((state) => {
        state.accounts = state.accounts.filter((row) => row.id !== id)
        state.pool.members = state.pool.members.filter((row) => row !== id)
        if (state.activeAccountId === id) state.activeAccountId = state.accounts[0]?.id ?? ''
        delete state.quota[id]
        delete state.checkin[id]
        // Per-model switches are a preference about models, not about this
        // account: removing one account must not reset them for the rest.
        return state
      })
      clearAllCooldowns()
      invalidateReadings()
      return json(res, 200, await snapshot(store, settings))
    }
    if (action === 'label') {
      const id = String(body?.id ?? '')
      const label = String(body?.label ?? '').slice(0, 80)
      await store.update((state) => {
        const account = state.accounts.find((row) => row.id === id)
        if (account) account.label = label
        return state
      })
      return json(res, 200, await snapshot(store, settings))
    }
    if (action === 'recheck') {
      // "Recheck" means the cooldowns are dropped and the readings are re-read,
      // so the user sees whether the account works again without a second click.
      clearAllCooldowns()
      invalidateReadings()
      const out = await snapshot(store, settings)
      try {
        out.credits.quota = await readQuota(store, { force: true })
      } catch (error) {
        out.credits.quotaError = error?.message ?? '读取积分失败'
      }
      try {
        out.credits.checkin = await readCheckin(store, { force: true })
      } catch (error) {
        out.credits.checkinError = error?.message ?? '读取签到状态失败'
      }
      return json(res, 200, out)
    }
    return json(res, 400, { error: 'action 必须是 select / remove / label / recheck' })
  })

  register('/pool', async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return
    const body = await readJson(req)
    await store.update((state) => {
      if (typeof body?.enabled === 'boolean') state.pool.enabled = body.enabled
      if (Array.isArray(body?.members)) {
        const known = new Set(state.accounts.map((row) => row.id))
        state.pool.members = body.members.filter((id) => typeof id === 'string' && known.has(id))
      }
      return state
    })
    invalidateReadings()
    return json(res, 200, await snapshot(store, settings))
  })

  register('/models', async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return
    const body = await readJson(req)
    const action = String(body?.action ?? 'toggle')
    if (action === 'refresh') {
      const status = await menuStatus(store, { force: true })
      return json(res, 200, { ...(await snapshot(store, settings)), refresh: status })
    }
    const id = String(body?.id ?? '')
    if (!id) return json(res, 400, { error: '缺少模型 id' })
    await store.update((state) => {
      const row = state.models[id] ?? { enabled: true, image: true }
      if (body?.enabled !== undefined) row.enabled = body.enabled === true
      if (body?.image !== undefined) row.image = body.image === true
      state.models[id] = row
      return state
    })
    invalidateReadings()
    return json(res, 200, await snapshot(store, settings))
  })

  register('/credits', async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return
    const body = await readJson(req)
    const force = body?.force === true
    const out = await snapshot(store, settings)
    // A failed read is reported beside the reading instead of failing the whole
    // request, and the page shows the message: silently returning the previous
    // numbers would make a failure look like a refresh that changed nothing.
    try {
      out.credits.quota = await readQuota(store, { force })
    } catch (error) {
      out.credits.quotaError = error?.message ?? '读取积分失败'
    }
    try {
      out.credits.checkin = await readCheckin(store, { force })
    } catch (error) {
      out.credits.checkinError = error?.message ?? '读取签到状态失败'
    }
    return json(res, 200, out)
  })

  // A cheap read the composer pill polls. Refreshes the allowance when the
  // cached copy has aged out, so a pill left on screen does not show a number
  // from days ago; the read itself is TTL-guarded, not per-poll.
  register('/pill', async (req, res) => {
    if (!requireMethod(req, res, 'GET')) return
    const state = await store.read()
    if (state.accounts.length) {
      try {
        await readQuota(store)
      } catch { /* keep the last good reading */ }
    }
    return json(res, 200, await pill(store))
  })

  /**
   * What the LLM registry actually holds for this plugin.
   *
   * Reports the live adapter registration rather than the plugin's own state, so
   * "the models do not appear in the selector" can be traced to the registry or
   * ruled out.
   */
  register('/diagnostics', async (req, res) => {
    if (!requireMethod(req, res, 'GET')) return
    const providers = ctx.llm.listProviders()
    let models
    let error = ''
    try {
      models = await ctx.llm.listModels(PROVIDER)
    } catch (cause) {
      models = []
      error = cause?.message ?? 'listModels 失败'
    }
    return json(res, 200, {
      provider: PROVIDER,
      registered: providers.some((row) => row.id === PROVIDER),
      providers: providers.map((row) => row.id),
      modelCount: models.length,
      models: models.map((row) => ({
        id: row.id,
        name: row.name,
        badge: row.badge?.text,
        modalities: row.inputModalities,
      })),
      error,
    })
  })

  ctx.effect(() => () => {
    stopped = true
    intervalDispose()
    for (const dispose of routes) {
      try { dispose() } catch { /* already gone */ }
    }
    releaseAdapter()
  }, 'dsh-doubaowork-connect: resources')
}

function settingsNamespace() {
  return 'dsh-doubaowork-connect'
}

async function addCookieAccount(store, body) {
  const cookieText = String(body?.cookie ?? '').trim()
  if (!cookieText) throw new BadRequest('请粘贴豆包的 Cookie。')
  const jar = parseCookieText(cookieText)
  if (!jar.sessionid && !jar.sessionid_ss) {
    throw new BadRequest('粘贴的 Cookie 里没有 sessionid，请从已登录的豆包页面复制完整的 Cookie。')
  }
  const candidate = {
    cookies: jar,
    deviceId: String(body?.deviceId ?? '').trim(),
    webId: String(body?.webId ?? '').trim(),
  }
  const id = accountIdOf(candidate)
  await store.update((state) => {
    const existing = state.accounts.find((row) => row.id === id)
    if (existing) {
      existing.cookies = candidate.cookies
      existing.deviceId = candidate.deviceId
      existing.webId = candidate.webId
    } else {
      state.accounts.push({
        id,
        label: `粘贴的账号 ${state.accounts.length + 1}`,
        profile: '',
        source: 'cookie',
        cookies: candidate.cookies,
        deviceId: candidate.deviceId,
        webId: candidate.webId,
        clientVersion: '',
        addedAt: Date.now(),
      })
    }
    if (!state.pool.members.length) {
      state.pool.members = state.accounts.filter((row) => !row.disabled).map((row) => row.id)
    }
    if (!state.activeAccountId) state.activeAccountId = state.accounts[0]?.id ?? ''
    return state
  })
  return [id]
}

/** A failure whose message is meant for the user, answered with 400. */
class BadRequest extends Error {}

/** Accept a Cookie header string or a JSON array of {name, value}. */
export function parseCookieText(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    const rows = JSON.parse(trimmed)
    const jar = {}
    for (const row of rows) {
      if (row && typeof row.name === 'string' && typeof row.value === 'string' && row.value) {
        jar[row.name] = row.value
      }
    }
    return jar
  }
  const jar = {}
  for (const part of trimmed.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name || !value) continue
    if (/[^\x20-\x7e]/.test(value)) continue
    jar[name] = value
  }
  return jar
}

function labelOf(found) {
  const candidate = found.cookies?.uid_tt || found.cookies?.sessionid || ''
  return `豆包账号 ${String(candidate).slice(0, 6) || found.profile}`
}

async function accountViews(store) {
  const state = await store.read()
  return state.accounts.map((account) => publicAccount(state, account))
}

function publicAccount(state, account) {
  return {
    id: account.id,
    label: account.label,
    profile: account.profile,
    source: account.source,
    disabled: account.disabled === true,
    addedAt: account.addedAt,
    username: account.cookies?.uid_tt ? String(account.cookies.uid_tt).slice(0, 8) : '',
    isActive: account.id === state.activeAccountId,
    isPoolMember: state.pool.members.includes(account.id),
    cooldown: cooldownSnapshot([account])[account.id],
  }
}

/** The page's whole view of the plugin. */
async function snapshot(store, settings) {
  const state = await store.read()
  const models = effectiveModels(state).map((model) => ({
    key: model.key,
    name: model.name,
    window: model.window,
    levels: model.levels,
    defaultEffort: model.defaultEffort,
    needUpgrade: model.needUpgrade,
    // The multiplier is whatever upstream said, verbatim; empty when upstream
    // sent none for this model.
    rateText: model.rateText ?? '',
    rateToken: model.rateToken ?? '',
    rate: typeof model.rate === 'number' ? model.rate : undefined,
    free: model.free === true,
    tag: model.tag ?? '',
    enabled: state.models?.[model.key]?.enabled !== false,
    image: state.models?.[model.key]?.image !== false,
  }))
  const active = state.accounts.find((row) => row.id === state.activeAccountId)
  const quota = active ? state.quota?.[active.id] : undefined
  const checkin = active ? state.checkin?.[active.id] : undefined
  return {
    provider: PROVIDER,
    providerName: PROVIDER_NAME,
    accounts: state.accounts.map((account) => publicAccount(state, account)),
    activeAccountId: state.activeAccountId,
    pool: { enabled: state.pool.enabled, members: state.pool.members },
    models,
    catalog: {
      source: state.catalog?.source ?? 'builtin',
      updatedAt: state.catalog?.updatedAt ?? 0,
      count: models.length,
    },
    credits: {
      quota: quota ?? undefined,
      checkin: checkin ?? undefined,
    },
    settings: {
      userDataDir: settings.userDataDir(),
      autoRefreshMinutes: settings.autoRefreshMinutes(),
      workspace: settings.workspace(),
    },
  }
}

/** The compact reading the composer pill shows. */
async function pill(store) {
  const state = await store.read()
  const active = state.accounts.find((row) => row.id === state.activeAccountId)
  const quota = active ? state.quota?.[active.id] : undefined
  const checkin = active ? state.checkin?.[active.id] : undefined
  const windows = Array.isArray(quota?.windows) ? quota.windows : []
  const monthly = windows.find((row) => /monthly|月度/i.test(row.feature)) ?? windows[0]
  return {
    hasAccount: Boolean(active),
    accountLabel: active?.label ?? '',
    remaining: quota?.remaining,
    windowRemaining: monthly?.remaining,
    windowTotal: monthly?.total,
    windowName: monthly?.name || '',
    quotaUpdatedAt: quota?.updatedAt,
    remainingIsNull: typeof quota?.remaining !== 'number',
    checkedIn: checkin?.checkedInToday === true,
    continuousDays: checkin?.continuousDays,
    accountCount: state.accounts.length,
    poolEnabled: state.pool.enabled,
  }
}

function requireMethod(req, res, method) {
  if (req.method === method) return true
  json(res, 405, { error: `method must be ${method}` })
  return false
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 2 * 1024 * 1024) throw new BadRequest('请求体过大。')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BadRequest('请求体不是有效 JSON。')
  }
}

/**
 * Who may call this API.
 *
 * The plugin holds real account credentials, so the route requires a loopback
 * `Host` and, when an `Origin` is present, a loopback one too. That combination
 * blocks the threat that matters — a page on another origin driving these
 * routes — because a browser always sends its own `Origin` and no page can forge
 * `Host`. A non-browser process on this machine can still call it; the plugin
 * runs inside the user's own session and has no stronger principal to check.
 */
function guard(req, res, run) {
  const host = String(req.headers.host ?? '')
  const origin = String(req.headers.origin ?? '')
  if (!isLoopbackAuthority(host) || (origin && !isLoopbackOrigin(origin))) {
    json(res, 403, { error: 'only a local page may call this API' })
    return
  }
  Promise.resolve()
    .then(run)
    .catch((error) => {
      const status = error instanceof BadRequest ? 400 : 500
      json(res, status, { error: error?.message ?? '内部错误' })
    })
}

/** True for a `host[:port]` authority that names this machine. */
function isLoopbackAuthority(value) {
  const hostname = splitAuthority(value)
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

/** Split `host:port`, `[::1]:port`, or a bare `[::1]` into a bare hostname. */
function splitAuthority(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    return end > 0 ? raw.slice(1, end) : ''
  }
  // A bare IPv6 literal has several colons and no port.
  const colons = (raw.match(/:/g) || []).length
  if (colons > 1) return raw
  return raw.split(':')[0]
}

function isLoopbackOrigin(value) {
  try {
    const url = new URL(value)
    return isLoopbackAuthority(url.host)
  } catch {
    return false
  }
}
