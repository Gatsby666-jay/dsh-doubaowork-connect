/**
 * Plugin-owned state: accounts, pool, per-model switches, cached catalog and
 * cached readings.
 *
 * This is the plugin's own data file, not the profile's `cordis.patch.yml` —
 * reads and writes are ordinary JSON, committed atomically so a crash mid-write
 * cannot leave a half state behind.
 */
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const STATE_VERSION = 2

export function dshHome() {
  const configured = process.env.DSH_HOME
  return configured && configured.trim() ? configured : join(homedir(), '.dsh')
}

export function statePath() {
  return process.env.DSH_DOUBAOWORK_STATE || join(dshHome(), '.doubaowork.cn.json')
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    accounts: [],
    activeAccountId: '',
    pool: { enabled: false, members: [] },
    models: {},
    catalog: { source: 'builtin', updatedAt: 0, models: [] },
    quota: {},
    checkin: {},
    lastError: '',
  }
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const cookies = raw.cookies && typeof raw.cookies === 'object' ? raw.cookies : {}
  if (!cookies.sessionid && !cookies.sessionid_ss) return undefined
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return undefined
  return {
    id,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 80) : '',
    profile: typeof raw.profile === 'string' ? raw.profile : '',
    source: raw.source === 'cookie' ? 'cookie' : raw.source === 'browser' ? 'browser' : 'desktop',
    cookies,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
    webId: typeof raw.webId === 'string' ? raw.webId : '',
    clientVersion: typeof raw.clientVersion === 'string' ? raw.clientVersion : '',
    addedAt: Number(raw.addedAt) || Date.now(),
    disabled: raw.disabled === true,
  }
}

/** Coerce whatever is on disk into a state this version understands. */
export function normalizeState(raw) {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts.map(normalizeAccount).filter(Boolean)
    : []
  const byId = new Map(accounts.map((account) => [account.id, account]))
  // Image input is opt-OUT (mirrors dsh-connect-workbuddy's effectiveImageIds).
  //
  // v1→v2 migration: in v1 `image` defaulted to FALSE (the old `=== true` gate
  // meant every untouched model read as text-only, so DSH stripped every attached
  // image with "image omitted because this model accepts text only"). Those stored
  // `image:false` values were never a user opt-out — they were the default — so on
  // the bump to v2 we flip every row to ON. From v2 on, `image:false` is written
  // only by an explicit toggle-off and is preserved as a real opt-out.
  const legacyImageDefaults = Number(raw.version || 1) < 2
  const models = {}
  if (raw.models && typeof raw.models === 'object') {
    for (const [id, value] of Object.entries(raw.models)) {
      if (!value || typeof value !== 'object') continue
      models[id] = {
        enabled: value.enabled !== false,
        image: legacyImageDefaults ? true : value.image !== false,
      }
    }
  }
  const poolMembers = Array.isArray(raw.pool?.members)
    ? raw.pool.members.filter((id) => byId.has(id))
    : []
  const catalog = raw.catalog && typeof raw.catalog === 'object'
    ? {
      source: typeof raw.catalog.source === 'string' ? raw.catalog.source : 'builtin',
      updatedAt: Number(raw.catalog.updatedAt) || 0,
      models: Array.isArray(raw.catalog.models) ? raw.catalog.models.filter((row) => row && typeof row.key === 'string') : [],
      accountScopes: raw.catalog.accountScopes && typeof raw.catalog.accountScopes === 'object' ? raw.catalog.accountScopes : {},
    }
    : base.catalog
  return {
    ...base,
    accounts,
    activeAccountId: byId.has(raw.activeAccountId) ? raw.activeAccountId : (accounts[0]?.id ?? ''),
    pool: { enabled: raw.pool?.enabled === true, members: poolMembers },
    models,
    catalog,
    quota: raw.quota && typeof raw.quota === 'object' ? raw.quota : {},
    checkin: raw.checkin && typeof raw.checkin === 'object' ? raw.checkin : {},
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
  }
}

export async function loadState() {
  const path = statePath()
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState()
    throw new Error(`读取插件状态失败：${error.message}`)
  }
  try {
    return normalizeState(JSON.parse(text))
  } catch {
    // A corrupt file must not brick the plugin; start clean and let the next
    // save overwrite it.
    return emptyState()
  }
}

export async function saveState(state) {
  const path = statePath()
  const normalized = normalizeState(state)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
  await chmod(path, 0o600).catch(() => {})
  return normalized
}

/** Serialize read-modify-write cycles so two UI actions cannot interleave. */
export function createStateStore() {
  let queue = Promise.resolve()
  let cache
  const run = (operation) => {
    const next = queue.then(async () => {
      if (cache === undefined) cache = await loadState()
      return operation(cache)
    })
    queue = next.then(() => {}, () => {})
    return next
  }
  return {
    read: () => run(async (state) => state),
    update: (mutate) => run(async (state) => {
      const draft = JSON.parse(JSON.stringify(state))
      const returned = await mutate(draft)
      const saved = await saveState(returned ?? draft)
      cache = saved
      return saved
    }),
    invalidate: () => { cache = undefined },
  }
}
