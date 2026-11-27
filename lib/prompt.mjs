/**
 * Render DSH messages into the single prompt string 豆包工作 accepts.
 *
 * The work-mode endpoint takes one text block per turn, so the whole
 * conversation is serialized: a system section, then a role-labelled transcript,
 * then any tool contract. Images travel separately as attachments, so they are
 * described in the transcript only as placeholders.
 */
export function renderPrompt({ messages, system, tools }) {
  const systems = []
  if (typeof system === 'string' && system.trim()) systems.push(system.trim())
  const transcript = []
  for (const message of messages ?? []) {
    const role = message?.role
    if (role === 'system' || role === 'developer') {
      const text = textOf(message)
      if (text) systems.push(text)
      continue
    }
    if (role === 'user') {
      const text = textOf(message)
      if (text) transcript.push(`User: ${text}`)
      continue
    }
    if (role === 'assistant') {
      const text = textOf(message)
      const calls = []
      for (const block of blocksOf(message)) {
        if (block?.type === 'tool-call' && block.name) {
          calls.push(`${block.name}(${trimArguments(block.arguments)})`)
        }
      }
      const parts = []
      if (text) parts.push(text)
      if (calls.length) parts.push(`[tool calls] ${calls.join('; ')}`)
      if (parts.length) transcript.push(`Assistant: ${parts.join('\n')}`)
      continue
    }
    if (role === 'tool') {
      const text = textOf(message)
      transcript.push(`Tool result: ${text || '(empty)'}`)
    }
  }
  const body = transcript.join('\n\n')
  const toolContract = tools?.length ? renderToolContract(tools) : ''
  const head = systems.length ? `System instructions:\n${systems.join('\n\n')}` : ''
  const middle = toolContract
  const tail = body ? `Conversation:\n${body}` : ''
  return [head, middle, tail].filter(Boolean).join('\n\n')
}

function blocksOf(message) {
  const content = message?.content
  return Array.isArray(content) ? content : []
}

function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block?.type === 'reasoning' && typeof block.text === 'string' && block.text.trim()) {
      // Keep the model's own prior thinking out of the transcript: the upstream
      // generates fresh thinking per call and replaying it reads as narration.
      continue
    } else if (block?.type === 'image') parts.push('[image attached]')
    else if (block?.type === 'file') parts.push(`[file: ${block.attachment?.name ?? 'attachment'}]`)
  }
  return parts.join('\n').trim()
}

function trimArguments(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const compact = raw.replace(/\s+/g, ' ').trim()
  return compact.length > 400 ? `${compact.slice(0, 400)}…` : compact
}

/**
 * The tool bridge contract.
 *
 * 豆包工作 has no native function-calling channel, so tool use is a text
 * protocol: the definitions are described here and the model must answer with a
 * single JSON envelope. The adapter validates the envelope before turning it
 * into tool-call blocks, so a malformed answer surfaces as text rather than as a
 * broken tool call.
 */
export function renderToolContract(tools) {
  const lines = [
    'You can call the tools below. When you need one, reply with ONLY this JSON object and nothing else:',
    '{"tool_calls":[{"name":"<tool name>","arguments":{...}}]}',
    'Rules:',
    '- At most 4 calls per reply; all in the same `tool_calls` array.',
    '- `arguments` must be a JSON object matching that tool\'s parameter schema.',
    '- Do not wrap the JSON in Markdown fences, and do not add prose before or after it.',
    '- When no tool is needed, answer normally in plain text.',
    '',
    'Available tools:',
  ]
  for (const tool of tools) {
    lines.push(`### ${tool.name}`)
    if (tool.description) lines.push(tool.description.trim())
    lines.push(`Parameters (JSON Schema): ${JSON.stringify(tool.parameters ?? { type: 'object', properties: {} })}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

/**
 * Pull a tool-call envelope out of an answer.
 * @returns {{calls: {name: string, arguments: string}[], rest: string} | undefined}
 */
export function parseToolEnvelope(text, tools) {
  if (typeof text !== 'string' || !text.trim()) return undefined
  const allowed = new Set((tools ?? []).map((tool) => tool.name))
  const candidates = []
  const trimmed = text.trim()
  candidates.push(trimmed)
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    let parsed
    try { parsed = JSON.parse(candidate) } catch { continue }
    const raw = Array.isArray(parsed?.tool_calls) ? parsed.tool_calls : []
    if (!raw.length) continue
    const calls = []
    for (const call of raw.slice(0, 4)) {
      const name = String(call?.name ?? '')
      if (!allowed.has(name)) return undefined
      let args = call?.arguments
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { return undefined }
      }
      if (args === undefined || args === null) args = {}
      if (typeof args !== 'object' || Array.isArray(args)) return undefined
      calls.push({ name, arguments: JSON.stringify(args) })
    }
    if (!calls.length) continue
    return { calls }
  }
  return undefined
}
