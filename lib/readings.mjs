/**
 * The slow-moving reads: model menu, allowance windows, check-in status.
 *
 * Caching is the whole point of this module. A menu refresh walks the whole
 * /chat page on every account, and the shell asks for readings far more often
 * than the upstreams change them, so each reading has a TTL and a single
 * in-flight promise. A failure keeps the previous value and records why, instead
 * of blanking a reading the user can still reason about.
 *
 * Every reading is filed under the account that produced it. The id is captured
 * BEFORE the fetch starts: if the user switches accounts while a read is in
 * flight, the result is still written under its own account, never under
 * whichever one happens to be active when it lands.
 */
import {
  fetchCheckin,
  fetchModelMenu,
  fetchQuota,
  isAuthError,
  launch,
} from './upstream.mjs'
import { mergeCatalog } from './catalog.mjs'
import { withAccount } from './pool.mjs'

const MENU_TTL_MS = 30 * 60 * 1000
const QUOTA_TTL_MS = 90 * 1000
const CHECKIN_TTL_MS = 10 * 60 * 1000
const MENU_RETRY_MS = 5 * 60 * 1000

/** One TTL slot with a de-duplicated loader. */
function slot(ttlMs, retryMs = ttlMs) {
  return {
    at: 0,
    value: undefined,
    error: '',
    pending: undefined,
    ttlMs,
    retryMs,
  }
}

const menuSlot = slot(MENU_TTL_MS, MENU_RETRY_MS)
const quotaSlot = slot(QUOTA_TTL_MS)
const checkinSlot = slot(CHECKIN_TTL_MS)

function fresh(entry) {
  if (!entry.at) return false
  const age = Date.now() - entry.at
  return age < (entry.error ? entry.retryMs : entry.ttlMs)
}

/**
 * Load through one TTL slot.
 * @param store   the state store
 * @param entry   the TTL slot
 * @param loader  receives the serving account, returns the value
 * @param apply   receives `(value, accountId)`; the id is the one the loader ran
 *                on, so a cache write cannot be attributed to another account
 */
async function load(store, entry, loader, apply) {
  if (fresh(entry)) return entry.value
  if (entry.pending) return entry.pending
  entry.pending = (async () => {
    try {
      const state = await store.read()
      const { result, account } = await withAccount(state, loader)
      const accountId = account.id
      entry.value = result
      entry.error = ''
      entry.at = Date.now()
      if (apply) await apply(result, accountId)
      return result
    } catch (error) {
      entry.error = error?.message ?? '未知错误'
      // Keep the last good value: a stale reading beats a blank one.
      if (entry.value === undefined) entry.at = Date.now()
      throw error
    } finally {
      entry.pending = undefined
    }
  })()
  return entry.pending
}

/** Refresh the model menu from upstream, merging it into the stored catalog. */
export async function refreshMenu(store, { force = false } = {}) {
  if (!force && fresh(menuSlot)) return menuSlot.value
  return load(store, menuSlot, async (account) => fetchModelMenu(account), async (menu, accountId) => {
    await store.update((state) => {
      state.catalog = mergeCatalog(state.catalog, menu.models, accountId)
      return state
    })
  })
}

/** Everything the settings page needs about a refresh, without throwing. */
export async function menuStatus(store, { force = false } = {}) {
  try {
    const menu = await refreshMenu(store, { force })
    return { ok: true, count: menu.models.length, error: '' }
  } catch (error) {
    return { ok: false, count: 0, error: error?.message ?? '刷新失败' }
  }
}

/** Allowance windows for the serving account. */
export async function readQuota(store, { force = false } = {}) {
  if (!force && fresh(quotaSlot)) return quotaSlot.value
  return load(store, quotaSlot, async (account) => fetchQuota(account), async (quota, accountId) => {
    await store.update((state) => {
      state.quota = { ...(state.quota ?? {}) }
      state.quota[accountId] = quota
      return state
    })
  })
}

/** Check-in status for the serving account. Read only. */
export async function readCheckin(store, { force = false } = {}) {
  if (!force && fresh(checkinSlot)) return checkinSlot.value
  return load(store, checkinSlot, async (account) => {
    let campaignGroupCode = ''
    try {
      const info = await launch(account)
      campaignGroupCode = info.campaignGroupCode
    } catch (error) {
      // A launch failure is not fatal for the check-in read: the campaign list
      // route answers without the group code.
      if (isAuthError(error)) throw error
    }
    return fetchCheckin(account, { campaignGroupCode })
  }, async (checkin, accountId) => {
    await store.update((state) => {
      state.checkin = { ...(state.checkin ?? {}) }
      state.checkin[accountId] = checkin
      return state
    })
  })
}

/** Drop every cached reading, e.g. after switching accounts. */
export function invalidateReadings() {
  for (const entry of [menuSlot, quotaSlot, checkinSlot]) {
    entry.at = 0
    entry.value = undefined
    entry.error = ''
    entry.pending = undefined
  }
}

export function readingErrors() {
  return {
    menu: menuSlot.error,
    quota: quotaSlot.error,
    checkin: checkinSlot.error,
  }
}
