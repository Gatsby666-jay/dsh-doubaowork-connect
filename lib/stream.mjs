/**
 * Turn upstream SSE frames into answer and reasoning text.
 *
 * `STREAM_CHUNK` carries `patch_op` entries whose `patch_value.content_block`
 * holds blocks: `block_type 10000` is answer text and `10040` is the thinking
 * container (a block parented to one of those is thinking too). A `patch_type`
 * of 1 means the text in that block is cumulative for the block, while other
 * values mean an append — the reconcile below handles both without losing or
 * duplicating a character.
 */
export class TextReconciler {
  constructor() {
    this.messageId = 'default'
    this.reasoningIds = new Set()
    this.views = new Map()
    this.emitted = new Map()
    this.lastKind = 'content'
    this.textKinds = new Map()
    this.active = undefined
  }

  /** Frames that switch conversation message reset the per-block state. */
  select(messageId) {
    if (messageId === undefined || messageId === null) return
    const next = String(messageId)
    if (next === this.messageId) return
    this.messageId = next
    this.reasoningIds.clear()
    this.textKinds.clear()
    this.active = undefined
    this.lastKind = 'content'
  }

  *feed(frame) {
    const { event, data } = frame
    this.select(data.message_id ?? data.meta?.message_id)

    if (event === 'FULL_MSG_NOTIFY') {
      const message = data.message
      if (!message || String(message.user_type ?? 2) !== '2') return
      this.select(message.message_id)
      let blocks = message.content_block
      if (blocks === undefined && typeof message.content === 'string') {
        try { blocks = JSON.parse(message.content) } catch { return }
      }
      yield* this.blocks(blocks, false)
      return
    }

    if (event === 'CHUNK_DELTA' && typeof data.text === 'string') {
      const key = data.block_id ? `${this.messageId}:${data.block_id}` : (this.active ?? `${this.messageId}:default`)
      const kind = data._thinking === true ? 'reasoning'
        : data._thinking === false ? 'content'
          : (this.textKinds.get(key) ?? this.lastKind)
      yield* this.text(key, kind, data.text, 'delta', true)
      return
    }

    let handled = false
    const content = data.content
    if (content && Array.isArray(content.content_block)) {
      handled = true
      yield* this.blocks(content.content_block, false)
    }
    for (const patch of Array.isArray(data.patch_op) ? data.patch_op : []) {
      const value = patch?.patch_value
      if (!value || !Array.isArray(value.content_block)) continue
      handled = true
      yield* this.blocks(value.content_block, patch.patch_type === 1 || patch.patch_type === '1')
    }
    if (handled) return
    if (typeof data.text === 'string' && data.text) {
      yield { kind: this.lastKind, text: data.text }
    }
  }

  *blocks(blocks, append) {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (!block || block.block_type !== 10040) continue
      if (typeof block.block_id === 'string') this.reasoningIds.add(block.block_id)
    }
    for (const block of blocks) {
      if (!block || block.block_type !== 10000) continue
      const info = block.content?.text_block
      if (!info || typeof info.text !== 'string') continue
      const key = `${this.messageId}:${block.block_id || 'default'}`
      const parent = block.parent_id || block.parent_block_id || block.control_info?.parent_block_id
      let kind = this.reasoningIds.has(block.block_id) || (parent && this.reasoningIds.has(parent))
        ? 'reasoning' : 'content'
      if (typeof info.icon_url === 'string' && /deep_think/i.test(info.icon_url)) kind = 'reasoning'
      if (typeof info.icon_url_dark === 'string' && /deep_think/i.test(info.icon_url_dark)) kind = 'reasoning'
      this.active = key
      this.lastKind = kind
      this.textKinds.set(key, kind)
      yield* this.text(key, kind, info.text, 'blocks', append)
    }
  }

  *text(key, kind, text, source, append) {
    if (typeof text !== 'string' || !text) return
    const emittedKey = `${key}|${kind}`
    const previous = this.emitted.get(emittedKey) ?? ''
    let delta = ''
    let next = previous

    if (!append) {
      // A replace patch carries the block's whole text.
      if (text.startsWith(previous)) {
        delta = text.slice(previous.length)
        next = text
      } else if (previous.startsWith(text)) {
        // A shorter snapshot adds nothing new.
        return
      } else {
        // Upstream revised text it already streamed. Appending keeps the answer
        // truthful instead of pretending the earlier text never happened.
        delta = text
        next = previous + text
      }
    } else if (text === previous) {
      return
    } else if (previous && text.length > previous.length && text.startsWith(previous)) {
      // Some blocks report a cumulative snapshot even on an append patch; the
      // only new part is the tail.
      delta = text.slice(previous.length)
      next = text
    } else {
      delta = text
      next = previous + text
    }

    if (!delta) return
    this.views.set(`${key}|${kind}|${source}`, next)
    this.emitted.set(emittedKey, next)
    yield { kind, text: delta }
  }
}

/** Block types and their meaning, for diagnostics. */
export const BLOCK = { text: 10000, thinking: 10040, attachment: 10052 }
