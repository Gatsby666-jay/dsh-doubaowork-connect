/**
 * Read the Doubao desktop client's login state off this machine.
 *
 * The client keeps its Chromium data under `<User Data>`. It has two layouts:
 *  - the plain Chromium one (`Default`, `Profile N`)
 *  - the multi-account `aha/users/<hash>/profile_explorer` layout the Doubao
 *    shell actually signs in to.
 * Both are tried; every candidate that carries a `sessionid` becomes an account.
 *
 * The Cookies database is locked while the client runs, so it is copied to a
 * temporary file first and the copy is deleted afterwards. Nothing is written
 * into the client's own directories.
 */
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { createDecipheriv, createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unprotect } from './dpapi.mjs'
import { readCookies } from './sqlite.mjs'

const DPAPI_PREFIX = Buffer.from('DPAPI', 'ascii')
const ACCEPTED_HOST = /(^|\.)doubao\.com$/i

/** Where Doubao's Chromium data may live, most likely first. */
export function candidateUserDataDirs() {
  const local = process.env.LOCALAPPDATA
  const roaming = process.env.APPDATA
  const home = process.env.USERPROFILE
  const out = []
  if (local) {
    out.push(join(local, 'DoubaoWork', 'User Data'))
    out.push(join(local, 'Doubao', 'User Data'))
    out.push(join(local, 'DoubaoWork'))
  }
  if (roaming) {
    out.push(join(roaming, 'DoubaoWork', 'User Data'))
    out.push(join(roaming, 'Doubao', 'User Data'))
  }
  if (home) {
    out.push(join(home, 'DoubaoWork', 'User Data'))
    out.push(join(home, 'DoubaoWork', 'LocalAppData', 'User Data'))
    out.push(join(home, 'Doubao', 'User Data'))
  }
  return [...new Set(out)].filter((dir) => existsSync(join(dir, 'Local State')))
}

/** Locate the client root that actually holds a `Local State` file. */
export async function resolveUserDataDir(configured) {
  if (configured && configured !== 'auto') {
    const dir = configured.endsWith('User Data') ? configured : join(configured, 'User Data')
    if (!existsSync(join(dir, 'Local State'))) {
      throw new Error(`在 ${dir} 找不到豆包客户端的 Local State 文件。请填客户端的 User Data 目录。`)
    }
    return dir
  }
  const found = candidateUserDataDirs()
  if (!found.length) {
    throw new Error(
      '本机没有找到已登录的豆包客户端。请先安装并登录一次豆包（或豆包工作），' +
      '或者在插件里改用「粘贴 Cookie」登录。查找过的位置：' + (process.env.LOCALAPPDATA || '%LOCALAPPDATA%') + ' 下的 Doubao、DoubaoWork。',
    )
  }
  return found[0]
}

/** Chromium's AES key, unprotected through DPAPI. */
async function masterKey(userDataDir) {
  const statePath = join(userDataDir, 'Local State')
  let state
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'))
  } catch (cause) {
    if (cause.code === 'ENOENT') throw new Error(`找不到 ${statePath}。请确认豆包客户端已安装并登录。`)
    throw new Error(`读取 ${statePath} 失败：${cause.message}`)
  }
  const encoded = state?.os_crypt?.encrypted_key
  if (!encoded) throw new Error('客户端配置里没有 os_crypt.encrypted_key，无法解读登录态。')
  const raw = Buffer.from(encoded, 'base64')
  if (!raw.subarray(0, 5).equals(DPAPI_PREFIX)) throw new Error('encrypted_key 不是 DPAPI 格式。')
  const key = await unprotect(raw.subarray(5))
  if (key.length !== 32) throw new Error(`客户端主密钥长度异常：${key.length} 字节。`)
  return { key, state }
}

/** Decrypt one Chromium cookie value; returns '' when it cannot be read. */
export function decryptValue(key, encrypted, host) {
  if (!encrypted?.length) return ''
  const prefix = encrypted.subarray(0, 3).toString('ascii')
  if (prefix === 'v20' || prefix === 'v21') {
    throw new Error(
      '这份登录态使用 app-bound 加密（' + prefix + '），插件进程解不开。' +
      '请在豆包客户端里退出登录再重新登录一次（会换回 v10），或改用粘贴 Cookie。',
    )
  }
  if (prefix !== 'v10' && prefix !== 'v11') return encrypted.toString('utf8')
  const nonce = encrypted.subarray(3, 15)
  const payload = encrypted.subarray(15)
  if (payload.length < 17) return ''
  const tag = payload.subarray(payload.length - 16)
  const body = payload.subarray(0, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  let plain = Buffer.concat([decipher.update(body), decipher.final()])
  // Chromium prefixes the host digest; the digest is over the host_key exactly
  // as stored (".doubao.com" keeps its dot), so try the shapes seen in the wild.
  if (plain.length > 32) {
    const candidates = [host, host.replace(/^\./, ''), `.${host.replace(/^\./, '')}`]
    for (const candidate of candidates) {
      const digest = createHash('sha256').update(candidate).digest()
      if (plain.subarray(0, 32).equals(digest)) { plain = plain.subarray(32); break }
    }
  }
  return plain.toString('utf8')
}

/** Every profile directory that could hold login state, newest Cookies first. */
export function candidateProfiles(userDataDir) {
  const out = []
  const push = (relative) => {
    const dir = join(userDataDir, relative)
    const cookies = join(dir, 'Network', 'Cookies')
    const legacy = join(dir, 'Cookies')
    const source = existsSync(cookies) ? cookies : existsSync(legacy) ? legacy : undefined
    if (!source) return
    let mtime = 0
    try { mtime = statSync(source).mtimeMs } catch { /* treat as oldest */ }
    out.push({ relative, dir, source, mtime })
  }

  try {
    const usersDir = join(userDataDir, 'aha', 'users')
    if (existsSync(usersDir)) {
      for (const hash of readdirSync(usersDir)) push(join('aha', 'users', hash, 'profile_explorer'))
    }
  } catch { /* ignore */ }

  push('Default')
  try {
    for (const name of readdirSync(userDataDir)) {
      if (/^Profile \d+$/.test(name)) push(name)
    }
  } catch { /* ignore */ }

  return out.sort((a, b) => b.mtime - a.mtime)
}

/** Copy a locked Cookies database aside and read it. */
async function readCookieRows(source) {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-doubaowork-'))
  try {
    const snapshot = join(temp, 'Cookies')
    await copyFile(source, snapshot)
    for (const suffix of ['-wal', '-shm']) {
      try { await copyFile(`${source}${suffix}`, `${snapshot}${suffix}`) } catch { /* absent is fine */ }
    }
    return (await readCookies(snapshot)).rows
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

/** Tea SDK tokens (web_id / user_unique_id) from a profile's Local Storage. */
async function readTeaTokens(profileDir) {
  const dir = join(profileDir, 'Local Storage', 'leveldb')
  let names
  try { names = await readdir(dir) } catch { return undefined }
  let best
  for (const name of names) {
    if (!/\.(log|ldb)$/.test(name)) continue
    let raw
    try { raw = await readFile(join(dir, name)) } catch { continue }
    const text = raw.toString('latin1')
    const pattern = /__tea_cache_tokens_1044603[\s\S]{0,80}?(\{"[^]*?\})(?=[^\x20-\x7e]|$)/g
    let match
    while ((match = pattern.exec(text))) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed && (parsed.web_id != null || parsed.user_unique_id != null)) best = parsed
      } catch { /* a half-written record is not the answer */ }
    }
  }
  return best
}

/**
 * Import every signed-in profile of this machine.
 * @returns {Promise<{userDataDir: string, accounts: object[], skipped: object[]}>}
 */
export async function importDesktop(configuredDir) {
  const userDataDir = await resolveUserDataDir(configuredDir)
  const { key, state } = await masterKey(userDataDir)
  const deviceId = String(state?.aha?.device?.device_id ?? '')
  const clientVersion = String(state?.doubao_version || state?.app_version || '') || undefined

  const accounts = []
  const skipped = []
  for (const profile of candidateProfiles(userDataDir)) {
    let rows
    try {
      rows = await readCookieRows(profile.source)
    } catch (cause) {
      skipped.push({ profile: profile.relative, reason: `Cookies 读不出来：${cause.message}` })
      continue
    }
    const jar = {}
    for (const row of rows) {
      const host = String(row.host || '')
      if (!ACCEPTED_HOST.test(host)) continue
      let value = typeof row.value === 'string' ? row.value : ''
      if (!value && row.encrypted?.length) {
        try { value = decryptValue(key, Buffer.from(row.encrypted), host) } catch (cause) {
          skipped.push({ profile: profile.relative, reason: cause.message })
          continue
        }
      }
      if (!value) continue
      // A failed decrypt yields a replacement-character-laden string; a cookie
      // header built from it throws at fetch time, so drop it here instead.
      if (/[^\x20-\x7e]/.test(value)) continue
      if (!(row.name in jar)) jar[row.name] = value
    }
    const sessionId = jar.sessionid || jar.sessionid_ss
    if (!sessionId) {
      skipped.push({ profile: profile.relative, reason: '这个配置里没有豆包登录会话。' })
      continue
    }
    const tokens = await readTeaTokens(profile.dir)
    accounts.push({
      profile: profile.relative,
      cookies: jar,
      deviceId,
      webId: tokens?.web_id != null ? String(tokens.web_id) : '',
      clientVersion,
    })
  }
  return { userDataDir, accounts, skipped }
}
