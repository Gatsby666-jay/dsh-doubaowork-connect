/**
 * The 豆包工作 HTTP client.
 *
 * Everything here speaks the same protocol the desktop client uses: the
 * `aid=497858` query string, the client's user agent, and the CSRF header taken
 * from the cookie jar. No official API exists, so every route is inferred from
 * the client and validated against a live account.
 *
 * Read-only by design for the points that matter: quota, the model menu and the
 * check-in status are GET-like metadata reads. There is deliberately NO check-in
 * claim here — the web session cannot check in, and an attempted claim can burn
 * that day's allowance permanently.
 */
import { createHash, randomUUID } from 'node:crypto'

const BASE = 'https://www.doubao.com'
const AID = '497858'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/147.0.7727.149 Safari/537.36 SamanthaDoubaoWork/2.37.16'
const DEFAULT_PC_VERSION = '2.37.16'
const DEFAULT_BOT_ID = '7338286299411103781'
const MAX_METADATA_BYTES = 4 * 1024 * 1024
const METADATA_TIMEOUT_MS = 25000

/** An upstream failure whose `code` callers can branch on. */
export class UpstreamError extends Error {
  constructor(message, { code = 'upstream_error', status, kind = 'error' } = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.code = code
    this.status = status
    this.kind = kind
  }
}

const AUTH_CODES = new Set(['401', '710012001'])
const CHALLENGE_CODES = new Set(['403', '412', '710010702', '710022002', '710022004', '712010702'])
const RATE_CODES = new Set(['429', '710022005', '710022006'])

function classify(code) {
  if (AUTH_CODES.has(code)) return 'auth'
  if (CHALLENGE_CODES.has(code)) return 'challenge'
  if (RATE_CODES.has(code)) return 'rate-limit'
  return 'error'
}

export function isAuthError(error) {
  return error instanceof UpstreamError && error.kind === 'auth'
}

export function isChallengeError(error) {
  return error instanceof UpstreamError && error.kind === 'challenge'
}

export function isRateLimitError(error) {
  return error instanceof UpstreamError && error.kind === 'rate-limit'
}

/**
 * Stable identifier for one account.
 *
 * `uid_tt` is the upstream user id, so the same person signed in through two
 * client profiles is one pool member rather than two. The session id is only the
 * fallback for a cookie set that carries no user id.
 */
export function accountIdOf(account) {
  const uid = String(account.cookies?.uid_tt || account.cookies?.uid_tt_ss || '')
  const seed = uid
    ? `uid:${uid}`
    : `session:${account.cookies?.sessionid || account.cookies?.sessionid_ss || ''}`
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

function query(account) {
  const cookieFp = account.cookies?.s_v_web_id
  const params = {
    aid: AID,
    real_aid: AID,
    device_id: account.deviceId || '',
    tea_uuid: account.deviceId || '',
    web_id: account.webId || '',
    device_platform: 'web',
    doubao_device_platform: 'desktop',
    language: 'zh',
    region: 'CN',
    sys_region: 'CN',
    pkg_type: 'release_version',
    version_code: '20800',
    pc_version: account.clientVersion || DEFAULT_PC_VERSION,
    doubao_pc_version: account.clientVersion || DEFAULT_PC_VERSION,
    runtime: 'web',
    runtime_version: '3.4.2',
    samantha_web: '1',
    web_platform: 'desktop',
    'use-olympus-account': '1',
    client_platform: 'pc_client',
    chromium_version: '147.0.7727.149',
    channel: 'win',
    fp: cookieFp || `verify_${account.deviceId || randomUUID()}`,
    tz_name: 'Asia/Shanghai',
    web_tab_id: randomUUID(),
  }
  return new URLSearchParams(Object.entries(params).sort()).toString()
}

export function cookieHeader(account) {
  return Object.entries(account.cookies ?? {})
    .filter(([, value]) => typeof value === 'string' && value && !/[^\x20-\x7e]/.test(value))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function baseHeaders(account, extra) {
  const csrf = account.cookies?.passport_csrf_token || account.cookies?.passport_csrf_token_default || ''
  const headers = {
    'User-Agent': USER_AGENT,
    Origin: BASE,
    Referer: `${BASE}/chat/`,
    'agw-js-conv': 'str',
    cookie: cookieHeader(account),
    ...extra,
  }
  if (csrf) headers['x-tt-passport-csrf-token'] = csrf
  return headers
}

function raiseForBody(payload) {
  const code = String(payload?.error_code ?? payload?.code ?? payload?.status_code ?? '')
  if (code === '' || code === '0' || code === '200') return
  const kind = classify(code)
  const message = kind === 'auth'
    ? '豆包登录已失效，请重新登录豆包客户端后再刷新。'
    : kind === 'challenge'
      ? '豆包要求人工验证，请先打开 https://www.doubao.com/chat/ 手动完成一次验证。'
      : kind === 'rate-limit'
        ? '豆包对这个账号限流了，请稍后再试。'
        : `豆包上游返回错误 ${code}。`
  throw new UpstreamError(message, { code, kind })
}

/** One account-scoped metadata POST; returns the parsed JSON body. */
export async function metadata(account, path, body, { signal } = {}) {
  const url = `${BASE}${path}?${query(account)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: baseHeaders(account, { Accept: 'application/json', 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      throw new UpstreamError('豆包要求重新登录（元数据接口重定向）。', { code: String(response.status), kind: 'auth' })
    }
    const text = await boundedText(response, MAX_METADATA_BYTES)
    if (!response.ok) {
      const kind = classify(String(response.status))
      throw new UpstreamError(
        kind === 'auth' ? '豆包登录已失效，请重新登录豆包客户端。'
          : kind === 'challenge' ? '豆包要求人工验证，请先在网页端完成一次验证。'
            : kind === 'rate-limit' ? '豆包对这个账号限流了，请稍后再试。'
              : `豆包上游返回 HTTP ${response.status}。`,
        { code: String(response.status), status: response.status, kind },
      )
    }
    let parsed
    try { parsed = JSON.parse(text) } catch {
      throw new UpstreamError('豆包元数据不是有效 JSON，格式可能已变化。', { code: 'invalid_metadata' })
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new UpstreamError('豆包元数据格式已变化。', { code: 'invalid_metadata' })
    }
    raiseForBody(parsed)
    return parsed
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (error?.name === 'AbortError') {
      throw new UpstreamError('连接豆包超时，请稍后重试。', { code: 'upstream_timeout' })
    }
    throw new UpstreamError(`连接豆包失败：${error?.message ?? '网络错误'}`, { code: 'network_error' })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function boundedText(response, limit) {
  const reader = response.body?.getReader()
  if (!reader) return await response.text()
  const chunks = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      try { await reader.cancel() } catch { /* ignore */ }
      throw new UpstreamError('豆包响应过大。', { code: 'invalid_metadata' })
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

/** Account launch info: bot id plus the incentive campaign group. */
export async function launch(account, options) {
  const payload = await metadata(account, '/alice/user/launch', {}, options)
  const data = payload.data ?? {}
  return {
    botId: String(data.assistant_bot_id || DEFAULT_BOT_ID),
    campaignGroupCode: String(data.ug_campaign_info?.campaign_group_code ?? ''),
  }
}

/**
 * The office-model menu, read from the /chat page's server-rendered state.
 *
 * The front-end `brief_list` route only carries the tool bar, and there is no
 * client-side endpoint for the model menu: it is inlined into the HTML. So the
 * page is fetched and one balanced JSON object is lifted out of it.
 */
export async function fetchModelMenu(account, options = {}) {
  const url = `${BASE}/chat/?${query(account)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS * 2)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      headers: baseHeaders(account, { Accept: 'text/html,application/xhtml+xml' }),
      signal: controller.signal,
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      throw new UpstreamError('豆包要求重新登录（对话页重定向）。', { code: 'auth_redirect', kind: 'auth' })
    }
    if (!response.ok) {
      const kind = classify(String(response.status))
      throw new UpstreamError(
        kind === 'auth' ? '豆包登录已失效，请重新登录豆包客户端。'
          : kind === 'challenge' ? '豆包要求人工验证，请先在网页端完成一次验证。'
            : `豆包对话页返回 HTTP ${response.status}。`,
        { code: String(response.status), status: response.status, kind },
      )
    }
    const html = await boundedText(response, 8 * 1024 * 1024)
    const menu = parseChatPage(html)
    if (!menu) {
      throw new UpstreamError('没有从豆包对话页解析出模型目录，页面格式可能已变化。', { code: 'menu_unparsed' })
    }
    return menu
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (error?.name === 'AbortError') {
      throw new UpstreamError('读取豆包对话页超时。', { code: 'upstream_timeout' })
    }
    throw new UpstreamError(`读取豆包对话页失败：${error?.message ?? '网络错误'}`, { code: 'network_error' })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

const MENU_KEY = '"modeSelectData"'

/** Lift `modeSelectData` out of a server-rendered page and pick the office mode. */
export function parseChatPage(html) {
  if (typeof html !== 'string' || !html) return null
  for (let at = 0; ;) {
    const found = html.indexOf(MENU_KEY, at)
    if (found < 0) return null
    at = found + MENU_KEY.length
    let index = at
    while (index < html.length && /\s/.test(html[index])) index++
    if (html[index] !== ':') continue
    index++
    while (index < html.length && /\s/.test(html[index])) index++
    if (html[index] !== '{') continue
    const end = endOfJsonObject(html, index)
    if (end < 0) continue
    let data
    try { data = JSON.parse(html.slice(index, end)) } catch { continue }
    const menu = fromMenuSelectData(data)
    if (menu) return menu
  }
}

function endOfJsonObject(source, start) {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (escaped) { escaped = false; continue }
    if (quoted && char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return index + 1
  }
  return -1
}

function fromMenuSelectData(data) {
  const conf = data?.menuConfV2 ?? data?.menuConf
  const modes = conf?.mode_list?.item_list
  if (!Array.isArray(modes)) return null
  const work = modes.find((mode) => mode?.default_conversation_mode === 'office'
    && Array.isArray(mode?.model_list?.item_list) && mode.model_list.item_list.length)
  if (!work) return null
  const models = []
  for (const item of work.model_list.item_list) {
    const model = toModelEntry(item, work.mode_id, work.agent_mode)
    if (model) models.push(model)
  }
  return models.length ? { modeId: String(work.mode_id ?? ''), models } : null
}

const EFFORT_BY_LEVEL = { 3: 'low', 4: 'medium', 5: 'high', 6: 'xhigh', 7: 'max' }

/**
 * One menu row to the plugin's model shape.
 *
 * The multiplier is read out of `tag_list` — the upstream sends it only as
 * display copy, never as its own field, so it is parsed rather than stored.
 */
export function toModelEntry(item, modeId, modeAgentMode) {
  const key = String(item?.model_item_key ?? '')
  if (!key) return null
  const modes = Array.isArray(item.conversation_mode_list) ? item.conversation_mode_list : []
  if (modes.length && !modes.includes('office')) return null
  const name = String(item.name || key)
  const extra = item.model_extra_params ?? {}
  const window = Number(extra.total_window_size ?? item.context_window ?? 0)
  const levels = []
  const rows = Array.isArray(item.reasoning_effort_config?.option_list)
    ? item.reasoning_effort_config.option_list
    : []
  for (const row of rows) {
    const effort = EFFORT_BY_LEVEL[String(row?.level ?? row?.value ?? '')]
    if (effort && !levels.includes(effort)) levels.push(effort)
  }
  const rawDefault = String(item.reasoning_effort_config?.default_level ?? '')
  const defaultEffort = EFFORT_BY_LEVEL[rawDefault] && levels.includes(EFFORT_BY_LEVEL[rawDefault])
    ? EFFORT_BY_LEVEL[rawDefault]
    : levels[levels.length - 1]
  const rate = readRate(item.tag_list)
  return {
    key,
    name: name.slice(0, 160),
    modeId: String(modeId ?? ''),
    itemId: Number(item.item_id ?? 0),
    agentMode: Number(item.agent_mode ?? modeAgentMode ?? 1),
    window: Number.isSafeInteger(window) && window > 0 ? window : 0,
    memoryProfile: typeof extra.memory_profile === 'string' ? extra.memory_profile : '',
    levels,
    defaultEffort,
    needUpgrade: item.subscribe_config?.need_upgrade === true,
    tag: String(item.tag_list?.[0]?.text ?? ''),
    rate: rate.rate,
    rateText: rate.text,
    rateToken: rate.token,
    free: rate.free,
    imageInput: item.image_input === true,
  }
}

/**
 * Read a cost multiplier out of upstream tag copy.
 *
 * `type 2` is a bare multiplier ("0.95x"); `type 6` carries a prefix
 * ("限时优惠 0.01x", "新上线 0.80x") or says "小额免费" with no digits. Full-width
 * digits and `×` / `倍` are accepted so a copy change cannot silently drop it.
 *
 * `token` is the figure exactly as upstream printed it — the badge shows that,
 * not a reformatted number, so "0.80x" never degrades to "0.8x".
 */
export function readRate(tags) {
  const list = Array.isArray(tags) ? tags : []
  for (const tag of list) {
    const raw = String(tag?.text ?? '')
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/．/g, '.')
      .replace(/[ｘＸ]/g, 'x')
      .trim()
    if (!raw) continue
    const match = raw.match(/\d+(?:\.\d+)?\s*[xX×]/) || raw.match(/\d+(?:\.\d+)?\s*倍/)
    if (match) {
      const rate = Number(match[0].match(/\d+(?:\.\d+)?/)?.[0])
      if (Number.isFinite(rate)) {
        return { rate, free: rate === 0, text: raw, token: match[0].replace(/\s+/g, '') }
      }
    }
    if (/免费/.test(raw)) return { rate: undefined, free: true, text: raw, token: '免费' }
  }
  return { rate: undefined, free: false, text: '', token: '' }
}

/** Allowance windows, kept exactly as upstream reports them. */
export async function fetchQuota(account, options) {
  const payload = await metadata(account, '/alice/commerce/sale/subscription/quota/summary/', {}, options)
  return normalizeQuota(payload)
}

function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[,\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeQuota(payload) {
  const data = payload?.data ?? {}
  const windows = []
  const seen = new Set()
  const walk = (value, group, feature, depth) => {
    if (depth > 20 || value === null || value === undefined) return
    if (Array.isArray(value)) { for (const child of value.slice(0, 500)) walk(child, group, feature, depth + 1); return }
    if (typeof value !== 'object') return
    const groupName = String(value.feature_group_name || value.title || group || '').slice(0, 120)
    const featureName = String(value.feature_group || feature || '').slice(0, 160)
    const limits = Array.isArray(value.window_limits) ? value.window_limits : []
    for (const row of limits) {
      if (!row || typeof row !== 'object') continue
      const total = parseAmount(row.total_amount)
      const used = parseAmount(row.used_amount)
      const windowType = String(row.window_type ?? '')
      const endTime = parseAmount(row.end_time)
      const identity = `${groupName}|${featureName}|${windowType}|${total}|${used}|${endTime}`
      if (seen.has(identity)) continue
      seen.add(identity)
      windows.push({
        name: groupName || '官方额度',
        feature: featureName,
        windowType,
        total,
        used,
        remaining: total !== null && used !== null ? Math.max(0, total - used) : null,
        percent: parseAmount(row.used_percent),
        endTime,
        unlimited: row.unlimited === true,
      })
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'window_limits') continue
      if (child && typeof child === 'object') walk(child, groupName, featureName, depth + 1)
    }
  }
  walk(data, '', '', 0)

  const buckets = Array.isArray(data.quota_blance_usage)
    ? data.quota_blance_usage.map((row) => ({
      category: Number(row?.category ?? 0),
      title: String(row?.title ?? ''),
      total: parseAmount(row?.total_amount),
      used: parseAmount(row?.used_amount),
      percent: parseAmount(row?.used_percent),
    }))
    : []

  return {
    windows,
    buckets,
    remaining: parseAmount(data.quota_remaining_amount),
    subscription: data.current_subscription
      ? {
        name: String(data.current_subscription.display?.short_name || data.current_subscription.display?.product_name || ''),
        skuKey: String(data.current_subscription.sku_key ?? ''),
        endTime: parseAmount(data.current_subscription.end_time),
      }
      : undefined,
    updatedAt: Date.now(),
  }
}

/**
 * Daily check-in status. READ ONLY — see the module comment: the web session
 * cannot claim this reward, and a failed attempt destroys the day's allowance.
 */
export async function fetchCheckin(account, { campaignGroupCode } = {}, options) {
  const group = campaignGroupCode || ''
  const routes = group
    ? [['/alice/ug/campaign/v3/detail/', { campaign_group_code: group }]]
    : []
  routes.push(['/alice/ug/campaign/list/', group ? { campaign_group_code: group } : {}])
  let lastError
  for (const [path, body] of routes) {
    let payload
    try {
      payload = await metadata(account, path, body, options)
    } catch (error) {
      lastError = error
      continue
    }
    const found = findDailyCheckin(payload?.data)
    if (found) return { ...found, updatedAt: Date.now() }
  }
  if (lastError) throw lastError
  return { available: false, updatedAt: Date.now() }
}

export function findDailyCheckin(data) {
  let result
  const walk = (value, depth) => {
    if (result || depth > 14 || value === null || value === undefined) return
    if (Array.isArray(value)) { for (const child of value.slice(0, 500)) walk(child, depth + 1); return }
    if (typeof value !== 'object') return
    const daily = value.daily_checkin
    if (daily && typeof daily === 'object' && value.campaign_code) {
      result = {
        available: true,
        campaignGroupCode: String(value.campaign_group_code ?? ''),
        campaignCode: String(value.campaign_code),
        title: String(value.title ?? ''),
        checkedInToday: daily.checked_in_today === true,
        continuousDays: parseAmount(daily.continuous_days),
        totalDays: parseAmount(daily.total_days),
        lastCheckinDate: daily.last_checkin_date ? String(daily.last_checkin_date) : undefined,
        rewardAmount: parseAmount(daily.reward?.reward_amount),
        rewardType: daily.reward?.reward_type ? String(daily.reward.reward_type) : undefined,
      }
      return
    }
    for (const child of Object.values(value)) walk(child, depth + 1)
  }
  walk(data, 0)
  return result
}

/** One streaming chat completion; yields raw upstream SSE frames. */
export async function* streamCompletion(account, request, options = {}) {
  yield* (await openCompletion(account, request, options)).frames
}

/**
 * Open one chat completion and return its frame iterator.
 *
 * Opening is separate from reading so the account pool can fail over on a
 * request that upstream rejects outright — a failure that happens before the
 * first frame is an account problem, while one after it is not.
 */
export async function openCompletion(account, request, options = {}) {
  const workspace = request.workspace || ''
  const localMessageId = randomUUID()
  const deviceName = request.deviceName || 'DESKTOP'
  const appId = request.appId || account.deviceId || ''
  const taskParam = {
    runtime_type: 2,
    sandbox_auth_type: 1,
    device_name: deviceName,
    folder_name: '',
    local_app_id: appId,
    local_device_id: account.deviceId || '',
    workspace,
  }
  const generalParam = {
    action: 0,
    thread_local_message_id: [localMessageId],
    client_option: { enable_sandbox: true, os: 'Linux', shared_folder_path: workspace ? [workspace] : [], workspace, sandbox_auth_type: 1 },
    runtime_type: 2,
    agent_task_param: taskParam,
    server_do_compare: true,
  }
  const effort = String(request.effortLevel ?? '')
  const modelExtraParams = {}
  if (request.memoryProfile) modelExtraParams.memory_profile = request.memoryProfile
  if (request.window) modelExtraParams.total_window_size = String(request.window)

  const payload = {
    client_meta: {
      local_conversation_id: `local_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      conversation_id: request.conversationId || '',
      bot_id: request.botId || DEFAULT_BOT_ID,
      last_section_id: '',
      last_message_index: null,
    },
    messages: [{
      local_message_id: localMessageId,
      content_block: [{
        block_type: 10000,
        content: { text_block: { text: request.prompt, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
        block_id: randomUUID(),
        parent_id: '',
        meta_info: [],
        extra_info: {},
        append_fields: [],
      }],
      message_status: 0,
    }],
    option: {
      send_message_scene: '',
      create_time_ms: Date.now(),
      collect_id: '',
      is_audio: false,
      answer_with_suggest: false,
      agent_mode: 1,
      tts_switch: false,
      need_deep_think: 10001,
      click_clear_context: false,
      from_suggest: false,
      is_regen: false,
      is_replace: false,
      is_from_click_option: false,
      is_from_click_softlink: false,
      disable_sse_cache: false,
      select_text_action: '',
      is_select_text: false,
      resend_for_regen: false,
      scene_type: 0,
      unique_key: randomUUID(),
      start_seq: 0,
      need_create_conversation: true,
      conversation_init_option: { project_id: '', need_ack_conversation: true },
      conversation_init_ext: {
        agent_task_param: JSON.stringify(taskParam),
        model_item_key: request.modelKey,
        reasoning_effort: effort,
        mode_id: request.modeId || '3',
      },
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: '',
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: '',
      shared_app_id: '',
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: true,
      is_ai_playground: false,
      is_old_user: true,
      general_task_param: generalParam,
      recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(Date.now() / 1000), append_sse_event_scene: 0 },
      message_storage_type: 0,
      related_deleted_message_ids: {},
      connector_info_list: [],
      model_config: {
        model_item_key: request.modelKey,
        reasoning_effort: Number(request.effortLevel ?? 0) || undefined,
        ...(Object.keys(modelExtraParams).length ? { model_extra_params: modelExtraParams } : {}),
      },
      aggregate_params: {
        mention_skill_list: '[]',
        mention_plugin_list: '[]',
        mention_ext: '[{}]',
        conversation_mode: '',
        mode_id: request.modeId || '3',
        model_item_key: request.modelKey,
        agent_mode: '1',
        reasoning_effort: effort,
        provider_id: '',
      },
    },
    user_context: [],
    ext: {
      general_task_param: JSON.stringify(generalParam),
      use_deep_think: '10001',
      agent_mode: '1',
      conversation_init_option: JSON.stringify({ project_id: '', need_ack_conversation: true }),
      sub_conv_firstmet_type: '1',
      collection_id: '',
      is_finish: '1',
      commerce_credit_config_enable: '0',
    },
  }

  const url = `${BASE}/chat/completion?${query(account)}`
  const headers = baseHeaders(account, {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    'last-event-id': 'undefined',
    'x-lgw-req-sdk-type': '3',
    'x-net-sdk-domain-dispatch': '1',
    'x-request-id': randomUUID(),
    'x-ttnet-bypass-decompression': '1',
    'x-flow-trace': `04-${randomUUID().replace(/-/g, '')}`,
  })
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: options.signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let body
    try { body = JSON.parse(text) } catch { body = undefined }
    if (body) raiseForBody(body)
    const kind = classify(String(response.status))
    throw new UpstreamError(
      kind === 'auth' ? '豆包登录已失效，请重新登录豆包客户端。'
        : kind === 'challenge' ? '豆包要求人工验证，请先在网页端完成一次验证。'
          : kind === 'rate-limit' ? '豆包对这个账号限流了，请稍后再试。'
            : `豆包对话接口返回 HTTP ${response.status}。`,
      { code: String(response.status), status: response.status, kind },
    )
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const text = await response.text().catch(() => '')
    let body
    try { body = JSON.parse(text) } catch { body = undefined }
    if (body) raiseForBody(body)
    throw new UpstreamError('豆包没有返回事件流，接口可能已变化。', { code: 'not_sse' })
  }
  return { frames: readSse(response, options.signal) }
}

/** Split an SSE body into `{ event, data }` frames. */
export async function* readSse(response, signal) {
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data = []
  let received = false
  for await (const part of response.body) {
    if (signal?.aborted) return
    buffer += decoder.decode(part, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue }
      if (line.startsWith('data:')) { data.push(line.slice(5).replace(/^ /, '')); continue }
      if (line !== '' || !data.length) continue
      const raw = data.join('\n').trim()
      data = []
      const frameEvent = event
      event = ''
      if (!raw || raw === '{}') continue
      if (raw === '[DONE]') { received = true; return }
      let parsed
      try { parsed = JSON.parse(raw) } catch { continue }
      if (!parsed || typeof parsed !== 'object') continue
      received = true
      yield { event: frameEvent, data: parsed }
      if (frameEvent === 'SSE_REPLY_END' && [1, '1'].includes(parsed.end_type)) return
    }
  }
  if (!received) throw new UpstreamError('豆包事件流在收到任何内容前就结束了。', { code: 'upstream_empty' })
}
