/**
 * The DSH model adapter for 豆包工作.
 *
 * One adapter serves every request: it resolves the account (directly or through
 * the pool), serializes the conversation into the single prompt the upstream
 * takes, streams the answer back as DSH chunks, and — when the upstream answers
 * with the text tool envelope — turns that into real tool-call blocks so the
 * harness tool loop keeps working.
 *
 * This is a duck-typed adapter rather than a subclass: the plugin package lives
 * outside the profile and carries no dependencies, so it cannot import the
 * `LlmAdapter` base class. Every method the registry calls is implemented here.
 */
import { effectiveModels, isImageEnabled, isModelEnabled, PROVIDER_NAME, rateLabel, rateTone } from './catalog.mjs'
import { withAccount } from './pool.mjs'
import { parseToolEnvelope, renderPrompt } from './prompt.mjs'
import { TextReconciler } from './stream.mjs'
import { openCompletion, UpstreamError } from './upstream.mjs'
import { uploadImage } from './image.mjs'

const EFFORT_LABELS = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
}

/** Read the bytes the harness stored for one image block. */
async function imageBytesOf(ctx, block) {
  const attachments = ctx.get('attachments')
  if (!attachments) throw new Error('当前 Harness 没有图片附件服务，无法读取图片。')
  const ref = block?.attachment
  if (!ref) return undefined
  const read = await attachments.readImage(ref)
  return { data: new Uint8Array(read.data), mimeType: ref.mediaType, filename: ref.name || 'image.png' }
}

function imageBlocksOf(messages) {
  const out = []
  for (const message of messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type === 'image' && block.attachment) out.push(block)
    }
  }
  return out
}

export class DoubaoWorkAdapter {
  /**
   * @param {object} deps
   * @param {import('./store.mjs').createStateStore} deps.store
   * @param {() => object} deps.ctx  host context, for the attachment service
   */
  constructor({ store, ctx }) {
    this.store = store
    this.ctx = ctx
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME }
  }

  providerRetryPolicy() {
    // The upstream returns structured codes, and a retry is only useful for the
    // transient ones; anything else should reach the user with its own message.
    return {
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['429', 'upstream_timeout', 'network_error', '500', '502', '503', '504'],
      initialDelayMs: 800,
      maxDelayMs: 6000,
      jitterRatio: 0.2,
    }
  }

  async listModels(provider) {
    const state = await this.store.read()
    return effectiveModels(state)
      .filter((model) => !model.needUpgrade && isModelEnabled(state, model.key))
      .map((model) => this.modelInfo(provider, model, state))
  }

  modelInfo(provider, model, state) {
    const rate = rateLabel(model)
    const info = {
      provider,
      id: model.key,
      name: model.name,
      description: describe(model),
      inputModalities: isImageEnabled(state, model.key) ? ['text', 'image'] : ['text'],
    }
    if (rate) info.badge = { text: rate, tone: rateTone(model) }
    return info
  }

  async resolveModel(provider, id, signal) {
    const state = await this.store.read()
    const model = findModelOrThrow(state, id)
    const info = this.modelInfo(provider, model, state)
    const resolved = {
      ...info,
      context: model.window > 0 ? { contextWindow: model.window } : undefined,
      defaultMaxTokens: undefined,
    }
    if (model.levels.length) {
      resolved.reasoning = {
        efforts: model.levels.map((effort) => ({
          id: effort,
          name: EFFORT_LABELS[effort] ?? effort,
          description: `${model.name} 的 ${EFFORT_LABELS[effort] ?? effort}推理强度`,
        })),
        defaultEffort: model.defaultEffort ?? model.levels[model.levels.length - 1],
      }
    }
    if (signal?.aborted) throw signal.reason ?? new Error('aborted')
    return resolved
  }

  async prepareCall(provider, id, signal) {
    const model = await this.resolveModel(provider, id, signal)
    return {
      model,
      stream: (options) => this.stream(options),
    }
  }

  async *stream(options) {
    const state = await this.store.read()
    const model = findModelOrThrow(state, options.model)
    const effort = options.reasoningEffort
    if (effort && model.levels.length && !model.levels.includes(effort)) {
      throw upstreamFail(`模型 ${model.name} 不支持推理强度 ${effort}（可选：${model.levels.join(' / ')}）。`, 'invalid_reasoning_effort')
    }
    const effortLevel = effort && model.levels.includes(effort)
      ? LEVEL_OF[effort]
      : LEVEL_OF[model.defaultEffort ?? model.levels[model.levels.length - 1] ?? ''] ?? undefined

    const prompt = renderPrompt({
      messages: options.messages,
      system: options.system,
      tools: options.tools,
    })

    const images = imageBlocksOf(options.messages)
    const allowImages = isImageEnabled(state, options.model)
    if (images.length && !allowImages) {
      throw upstreamFail(`模型 ${model.name} 的图片输入开关是关闭的。请在插件设置的模型分页里打开它。`, 'image_not_enabled')
    }

    const { result: stream, account } = await withAccount(state, async (account) => {
      let prepared
      if (images.length) {
        prepared = []
        for (const block of images) {
          const bytes = await imageBytesOf(this.ctx, block)
          if (!bytes) continue
          prepared.push(await uploadImage(account, bytes, { signal: options.signal }))
        }
      }
      // Opening the stream is the point where an account problem surfaces, so
      // it happens inside the failover loop; draining it happens outside.
      const opened = await openCompletion(account, {
        prompt,
        modelKey: model.key,
        modeId: model.modeId,
        effortLevel: effortLevel,
        memoryProfile: model.memoryProfile,
        window: model.window,
        attachments: prepared?.map((row) => row.attachment),
        workspace: workspaceOf(this.ctx, options),
      }, { signal: options.signal })
      return opened.frames
    })

    const reconciler = new TextReconciler()
    let answer = ''
    let reasoning = ''
    let textIndex = -1
    let reasoningIndex = -1
    let textOpen = false
    let reasoningOpen = false
    let finished = false

    const open = (kind) => {
      if (kind === 'reasoning') {
        if (reasoningOpen) return undefined
        reasoningOpen = true
        reasoningIndex = nextIndex(reasoningIndex, textIndex)
        return { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
      }
      if (textOpen) return undefined
      textOpen = true
      textIndex = nextIndex(textIndex, reasoningIndex)
      return { type: 'block-start', index: textIndex, blockType: 'text' }
    }

    try {
      for await (const frame of stream) {
        if (frame.event === 'SSE_REPLY_END') { finished = true }
        for (const piece of reconciler.feed(frame)) {
          if (!piece.text) continue
          if (piece.kind === 'reasoning') {
            const start = open('reasoning')
            if (start) yield start
            reasoning += piece.text
            yield { type: 'reasoning-delta', index: reasoningIndex, text: piece.text }
          } else {
            const start = open('text')
            if (start) yield start
            answer += piece.text
            yield { type: 'text-delta', index: textIndex, text: piece.text }
          }
        }
        if (options.signal?.aborted) break
      }
    } catch (error) {
      // Whatever already streamed stays visible; the failure is reported as the
      // finish reason so the harness shows it on the turn.
      const failure = toFailure(error)
      if (reasoningOpen) {
        yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
      }
      if (textOpen) {
        yield { type: 'block-end', index: textIndex, block: { type: 'text', text: answer } }
      }
      yield { type: 'finish', reason: { kind: 'error', failure } }
      return
    }

    // A text tool envelope is the upstream's function-calling channel: replace
    // the answer text with real tool-call blocks when it parses.
    const envelope = options.tools?.length ? parseToolEnvelope(answer, options.tools) : undefined
    if (envelope) {
      if (textOpen) {
        yield { type: 'block-end', index: textIndex, block: { type: 'text', text: answer } }
        textOpen = false
      }
      let callIndex = textIndex + 1
      for (const call of envelope.calls) {
        const id = `call_${Math.random().toString(36).slice(2, 12)}`
        yield { type: 'block-start', index: callIndex, blockType: 'tool-call' }
        yield { type: 'block-end', index: callIndex, block: { type: 'tool-call', id, name: call.name, arguments: call.arguments } }
        callIndex++
      }
      if (reasoningOpen) {
        yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
        reasoningOpen = false
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (reasoningOpen) {
      yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
      reasoningOpen = false
    }
    if (textOpen) {
      yield { type: 'block-end', index: textIndex, block: { type: 'text', text: answer } }
      textOpen = false
    }
    if (!textOpen && !reasoningOpen && !answer && !reasoning && !finished) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'upstream_empty', message: '豆包没有返回任何内容。' } } }
      return
    }
    yield {
      type: 'finish',
      reason: options.signal?.aborted ? { kind: 'aborted', failure: { code: 'aborted', message: '已取消。' } } : { kind: 'stop' },
    }
  }
}

const LEVEL_OF = { low: '3', medium: '4', high: '5', xhigh: '6', max: '7' }

/**
 * The directory the upstream is told this work runs in.
 *
 * 豆包 wants a workspace path for its sandbox parameters; the session's own
 * directory is the honest answer, and an empty string is what the client itself
 * sends when a task has no folder.
 */
function workspaceOf(ctx, options) {
  try {
    const session = options.sessionId
    const working = ctx.get('workingDirectory')
    if (session && working?.get) {
      const dir = working.get({ id: session })
      if (typeof dir === 'string' && dir) return dir
    }
  } catch { /* fall back to the configured value */ }
  return ''
}

function nextIndex(current, other) {
  return Math.max(current, other) + 1
}

function findModelOrThrow(state, id) {
  const model = effectiveModels(state).find((row) => row.key === id)
  if (!model) {
    throw upstreamFail(`当前目录里没有模型 ${id}，请刷新模型目录后再试。`, 'unknown_model')
  }
  if (model.needUpgrade) {
    throw upstreamFail(`模型 ${model.name} 需要升级订阅后才能使用。`, 'need_upgrade')
  }
  return model
}

function describe(model) {
  const bits = []
  if (model.window > 0) bits.push(`上下文 ${Math.round(model.window / 1000)}K`)
  if (model.levels.length) bits.push(`推理档位 ${model.levels.join('/')}`)
  if (model.rateText) bits.push(model.rateText)
  return bits.join(' · ')
}

function upstreamFail(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function toFailure(error) {
  if (error instanceof UpstreamError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return { code: error?.code ?? 'upstream_error', message: error?.message ?? '豆包调用失败。' }
}
