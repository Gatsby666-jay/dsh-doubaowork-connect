/**
 * Account selection, the pool, and the auto-switch rule.
 *
 * Two modes, and the rule between them is deliberately simple to explain:
 *  - pool off: the account the user picked serves every request.
 *  - pool on:  the enabled pool members serve in turn; when a request fails for
 *    an account-specific reason (expired session, verification demand, rate
 *    limit) the next member is tried for THAT request, and the failing member is
 *    put on a cooldown instead of being retried in a tight loop.
 *
 * "Account-specific" is the discriminator: a network error or a malformed reply
 * says nothing about the account, so it fails the request instead of burning
 * through the pool.
 */
import { isAuthError, isChallengeError, isRateLimitError } from './upstream.mjs'

const COOLDOWN_MS = {
  auth: 12 * 60 * 60 * 1000,
  challenge: 30 * 60 * 1000,
  'rate-limit': 3 * 60 * 1000,
}
const FAILURE_WINDOW_MS = 10 * 60 * 1000
const FAILURE_THRESHOLD = 3

/** Per-account runtime bookkeeping that must not be persisted. */
const runtime = new Map()

function slotOf(accountId) {
  let slot = runtime.get(accountId)
  if (!slot) {
    slot = { cooldownUntil: 0, reason: '', failures: [] }
    runtime.set(accountId, slot)
  }
  return slot
}

export function cooldownOf(accountId) {
  const slot = slotOf(accountId)
  if (slot.cooldownUntil <= Date.now()) return undefined
  return { until: slot.cooldownUntil, reason: slot.reason }
}

export function isUsable(account) {
  if (account.disabled) return false
  return cooldownOf(account.id) === undefined
}

export function markSuccess(accountId) {
  const slot = slotOf(accountId)
  slot.failures = []
  slot.cooldownUntil = 0
  slot.reason = ''
}

/** Record one upstream failure; repeated account-specific failures cool down. */
export function markFailure(accountId, error) {
  const slot = slotOf(accountId)
  if (isAuthError(error)) {
    slot.cooldownUntil = Date.now() + COOLDOWN_MS.auth
    slot.reason = '登录已失效，请重新登录豆包客户端'
    return
  }
  if (isChallengeError(error)) {
    slot.cooldownUntil = Date.now() + COOLDOWN_MS.challenge
    slot.reason = '豆包要求人工验证'
    return
  }
  if (isRateLimitError(error)) {
    slot.cooldownUntil = Date.now() + COOLDOWN_MS['rate-limit']
    slot.reason = '上游限流'
    return
  }
  const now = Date.now()
  slot.failures = slot.failures.filter((at) => now - at < FAILURE_WINDOW_MS)
  slot.failures.push(now)
  if (slot.failures.length >= FAILURE_THRESHOLD) {
    slot.cooldownUntil = now + COOLDOWN_MS['rate-limit']
    slot.reason = '连续失败，暂时跳过'
    slot.failures = []
  }
}

/** True when the failure says something about this account rather than the network. */
export function isAccountSpecific(error) {
  return isAuthError(error) || isChallengeError(error) || isRateLimitError(error)
}

/**
 * The accounts a request may try, in order.
 *
 * Pool members are tried in their listed order; the explicitly selected account
 * is moved to the front when it is a member so a manual choice still wins.
 */
export function candidateAccounts(state) {
  const byId = new Map((state.accounts ?? []).map((account) => [account.id, account]))
  if (!state.pool?.enabled) {
    const chosen = byId.get(state.activeAccountId)
    return chosen ? [chosen] : []
  }
  const order = []
  const active = byId.get(state.activeAccountId)
  if (active && (state.pool.members ?? []).includes(active.id)) order.push(active)
  for (const id of state.pool.members ?? []) {
    const account = byId.get(id)
    if (account && !order.some((row) => row.id === account.id)) order.push(account)
  }
  if (!order.length) {
    // Pool on but nothing selected: fall back to the active account so a
    // mis-click on the pool switch cannot silently disable every request.
    return active ? [active] : []
  }
  return order
}

/** Accounts worth showing as available right now (skips cooldowns). */
export function usableCandidates(state) {
  return candidateAccounts(state).filter(isUsable)
}

/**
 * Run `operation` against the best available account, failing over once per
 * remaining candidate for account-specific errors only.
 */
export async function withAccount(state, operation) {
  const candidates = usableCandidates(state)
  if (!candidates.length) {
    const anyConfigured = (state.accounts ?? []).length > 0
    const error = new Error(anyConfigured
      ? '账号池里没有可用账号：都在冷却或都没勾选。'
      : '还没有登录豆包工作账号，请在插件设置里导入。')
    error.code = anyConfigured ? 'no_usable_account' : 'no_account'
    throw error
  }
  let lastError
  for (const account of candidates) {
    try {
      const result = await operation(account)
      markSuccess(account.id)
      return { result, account }
    } catch (error) {
      lastError = error
      markFailure(account.id, error)
      // A network error or a malformed reply is not this account's fault, so
      // trying the next one would just fail again with wasted time.
      if (!isAccountSpecific(error)) throw error
    }
  }
  throw lastError ?? new Error('所有可用账号都失败了。')
}

/** Cooldown view for the settings page. */
export function cooldownSnapshot(accounts) {
  const out = {}
  for (const account of accounts ?? []) {
    const cooldown = cooldownOf(account.id)
    if (cooldown) out[account.id] = { until: cooldown.until, reason: cooldown.reason }
  }
  return out
}

export function clearAllCooldowns() {
  runtime.clear()
}
