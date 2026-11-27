/**
 * Model identity and selection.
 *
 * The DSH model id is the upstream `model_item_key` itself: it is exact, it maps
 * back without a lookup table, and it never collides across menu refreshes. The
 * display name and the credit multiplier come from the upstream menu; only the
 * ordering and the description are ours.
 *
 * `BASELINE` exists so the selector is usable before the first successful
 * refresh. It deliberately carries NO multiplier — a multiplier is only ever
 * shown when upstream sent one.
 */
import { toModelEntry } from './upstream.mjs'

export const PROVIDER = 'doubaowork'
export const PROVIDER_NAME = '豆包工作'

/** Menu rows last verified from a real account; identity only, no rates. */
const BASELINE_ROWS = [
  { model_item_key: '9', name: '自动', model_extra_params: { total_window_size: '300000' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }], default_level: 4 } },
  { model_item_key: 'seed-lite-7b', name: '豆包 2.1 Lite', model_extra_params: { total_window_size: '256000', memory_profile: '256k' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }], default_level: 4 } },
  { model_item_key: '5', name: '豆包 2.1 Pro', model_extra_params: { total_window_size: '256000' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }], default_level: 5 } },
  { model_item_key: 'person-deepseek-v4-1-flash-261017', name: 'DeepSeek V4.1 Flash', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }, { level: 6 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-deepseek-v4-pro-ga-260813', name: 'DeepSeek V4 Pro', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }, { level: 6 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-kimi-k3-1-pro-261111', name: 'Kimi K3.1 Pro', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }, { level: 6 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-kimi-k3-1-pro-highspeed-261111', name: 'Kimi K3.1 Pro 高速', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }, { level: 6 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-kimi-k3-261111', name: 'Kimi K3', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }, { level: 6 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-glm-5-3-261111', name: 'GLM 5.3', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-glm-5-3-flash-261111', name: 'GLM 5.3 Flash', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-glm-5-4', name: 'GLM 5.4', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 7 }], default_level: 5 } },
  { model_item_key: 'person-qwen3-8-flash', name: 'Qwen 3.8 Flash', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 6 }], default_level: 5 } },
  { model_item_key: 'person-qwen3-8-max', name: 'Qwen 3.8 Max', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 6 }], default_level: 5 } },
  { model_item_key: 'person-qwen4-max', name: 'Qwen 4 Max', model_extra_params: { total_window_size: '300000', memory_profile: '300k_230' }, reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 6 }], default_level: 5 } },
]

export function baselineCatalog() {
  const models = []
  for (const row of BASELINE_ROWS) {
    const entry = toModelEntry(row, '3', 1)
    if (entry) models.push({ ...entry, rate: undefined, rateText: '', free: false, needUpgrade: false })
  }
  return models
}

/** The catalog to serve: the refreshed one, else the baseline. */
export function effectiveModels(state) {
  const stored = Array.isArray(state.catalog?.models) ? state.catalog.models : []
  return stored.length ? stored : baselineCatalog()
}

/** A model is available when it is not subscription-locked and is switched on. */
export function isModelEnabled(state, key) {
  const row = state.models?.[key]
  if (row && row.enabled === false) return false
  return true
}

/**
 * Image input is OPT-OUT (mirrors dsh-connect-workbuddy's `effectiveImageIds`):
 * a model accepts images unless the user explicitly turned its switch off.
 *
 * Why default-ON and not WorkBuddy's `imageDefaultFor` (which only pre-checks a
 * vendored `NATIVE_MODALITY_BY_MODEL_ID` and leaves `unknown` unchecked): the
 * Doubao office menu reports `image_input: undefined` for EVERY model, so we get
 * no capability signal at all — and these person-* entries (DeepSeek V4 / GLM 5 /
 * Qwen 4 / Kimi K3 / MiMo V2) are uniformly multimodal. Gating on `=== true`
 * (default-OFF) made every model report `["text"]`, so DSH silently dropped
 * every attached image ("image omitted because this model accepts text only").
 * Default-ON + a per-model opt-out switch is the behaviour that actually gives
 * the model vision while still honouring "逐模型开关图片输入". A genuinely
 * text-only model is one toggle away from blocking images again.
 */
export function isImageEnabled(state, key) {
  return state.models?.[key]?.image !== false
}

export function visibleModels(state) {
  return effectiveModels(state).filter((model) => !model.needUpgrade && isModelEnabled(state, model.key))
}

/** Find one model by its upstream key. */
export function findModel(state, key) {
  return effectiveModels(state).find((model) => model.key === key)
}

/**
 * The badge label: the multiplier exactly as upstream printed it.
 *
 * No reformatting — "0.80x" from upstream stays "0.80x" here, because a number
 * the plugin rounded would be a number the plugin invented.
 */
export function rateLabel(model) {
  if (typeof model.rateToken === 'string' && model.rateToken) return model.rateToken
  if (model.free) return '免费'
  if (typeof model.rate === 'number' && Number.isFinite(model.rate)) {
    const text = String(model.rate)
    return `${text}x`
  }
  return ''
}

/** Badge tone follows how expensive the model is relative to the subscription. */
export function rateTone(model) {
  if (model.free) return 'success'
  if (typeof model.rate !== 'number' || !Number.isFinite(model.rate)) return 'neutral'
  if (model.rate <= 0.1) return 'success'
  if (model.rate <= 0.6) return 'info'
  if (model.rate <= 1) return 'neutral'
  return 'warning'
}

/**
 * Merge a freshly fetched menu into the stored catalog.
 *
 * Rows are stamped with `seenAt` and a full refresh prunes anything the upstream
 * no longer lists — otherwise a retired model would stay in the selector forever
 * and keep showing its last-known multiplier as if it were current. A model the
 * user explicitly switched is remembered in `state.models`, which this function
 * does not touch.
 */
export function mergeCatalog(previous, fetched, accountId) {
  const now = Date.now()
  const byKey = new Map()
  for (const model of Array.isArray(previous?.models) ? previous.models : []) byKey.set(model.key, model)
  const fetchedKeys = new Set()
  for (const model of fetched) {
    fetchedKeys.add(model.key)
    byKey.set(model.key, { ...model, seenAt: now })
  }
  // Anything absent from this response is retired upstream; drop it. The
  // baseline list is regenerated on demand, so an empty catalog still works.
  const models = [...byKey.values()].filter((model) => fetchedKeys.has(model.key) || !model.seenAt)
  return {
    source: 'official',
    updatedAt: now,
    models,
    // Only the models this exact account can serve, so a later surface does not
    // offer a route the account cannot complete.
    accountScopes: {
      ...(previous?.accountScopes ?? {}),
      ...(accountId ? { [accountId]: fetched.filter((model) => !model.needUpgrade).map((model) => model.key) } : {}),
    },
  }
}
