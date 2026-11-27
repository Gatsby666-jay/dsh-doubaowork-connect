/**
 * Attach an image to a Doubao work conversation.
 *
 * Three steps, all derived from the desktop client's own flow:
 *  1. `/alice/resource/prepare_upload` hands back short-lived ImageX credentials.
 *  2. The bytes go to ImageX (signed with those credentials, never the cookie
 *     jar) and are committed.
 *  3. `/alice/resource/register` binds the stored URI to this exact account.
 *
 * Account cookies are only ever sent to doubao.com; the storage hosts see the
 * upload authorization alone.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { UpstreamError } from './upstream.mjs'

const BASE = 'https://www.doubao.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/147.0.7727.149 Safari/537.36 SamanthaDoubaoWork/2.37.16'

/**
 * Resolve a host the STORAGE service told us to use.
 *
 * The host is chosen per upload by ImageX and it is not stable. Sampling five
 * consecutive uploads on one account gave `tos-lf-x.snssdk.com` four times and
 * `tos-d-x-hl.snssdk.com` once, and other calls have returned
 * `tos-lq-x.bytedancevod.com` and `tos-mya2lq.vodupload.com`. A fixed
 * three-suffix allowlist therefore rejected perfectly valid responses, which
 * surfaced as "upload failed" on roughly every other attempt.
 *
 * So the rule is about SHAPE plus a pinned ByteDance parent domain, not one
 * exact host. Credentials never travel here — only the short-lived upload Auth
 * token does, never the cookie jar — but a wildcard would still let a
 * compromised response point the bytes somewhere unrelated, so the suffix
 * still has to be one of ByteDance's storage domains.
 */
const STORAGE_HOST_SUFFIXES = [
  '.byteimg.com',
  '.bytedanceapi.com',
  '.bytedancevod.com',
  '.snssdk.com',
  '.vodupload.com',
  '.volcengineapi.com',
  '.volces.com',
]

function imagexHost(host) {
  if (typeof host !== 'string' || !host) {
    throw new UpstreamError('豆包返回了无效的图片上传域名。', { code: 'image_host_invalid' })
  }
  const name = host.trim().toLowerCase()
  // Reject anything that is not a bare DNS name: userinfo, port, path, scheme.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(name)) {
    throw new UpstreamError('豆包返回了无效的图片上传域名。', { code: 'image_host_invalid' })
  }
  if (!STORAGE_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    throw new UpstreamError(`豆包返回了不受支持的图片上传域名（${name}）。`, { code: 'image_host_invalid' })
  }
  return `https://${name}`
}


function imagexQuery(params) {
  return Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&')
}

/** AWS4 signing with the short-lived ImageX STS credentials. */
export function signImagexRequest(method, params, credentials, body = Buffer.alloc(0), now = new Date()) {
  const timestamp = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
  const day = timestamp.slice(0, 8)
  const scope = `${day}/cn-north-1/imagex/aws4_request`
  const headers = {
    'x-amz-date': timestamp,
    'x-amz-security-token': credentials.session_token,
  }
  if (body.length) headers['x-amz-content-sha256'] = createHash('sha256').update(body).digest('hex')
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('')
  const query = imagexQuery(params)
  const canonical = [method.toUpperCase(), '/', query, canonicalHeaders, signedHeaders,
    createHash('sha256').update(body).digest('hex')].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope,
    createHash('sha256').update(canonical).digest('hex')].join('\n')
  let key = Buffer.from(`AWS4${credentials.secret_key}`, 'utf8')
  for (const part of [day, 'cn-north-1', 'imagex', 'aws4_request']) {
    key = createHmac('sha256', key).update(part).digest()
  }
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.access_key}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}

/** CRC32 without a dependency, for the storage `Content-CRC32` header. */
function crc32(buffer) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let index = 0; index < 256; index++) {
      let value = index
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      table[index] = value
    }
  }
  let crc = -1
  for (let index = 0; index < buffer.length; index++) crc = (crc >>> 8) ^ table[(crc ^ buffer[index]) & 0xff]
  return ((crc ^ -1) >>> 0)
}

function parseBody(text, stage) {
  let body
  try { body = JSON.parse(text) } catch {
    throw new UpstreamError(`豆包图片${stage}返回了无效的 JSON。`, { code: 'image_response_invalid' })
  }
  if (!body || typeof body !== 'object') {
    throw new UpstreamError(`豆包图片${stage}返回了无效的响应。`, { code: 'image_response_invalid' })
  }
  const metadata = body.ResponseMetadata
  if (metadata && metadata.Error) {
    throw new UpstreamError(`豆包拒绝了图片${stage}。`, { code: 'image_rejected' })
  }
  return body
}

async function failStatus(response, stage) {
  const code = String(response.status)
  const kind = code === '401' || code === '403' ? 'auth' : code === '429' ? 'rate-limit' : 'error'
  throw new UpstreamError(
    kind === 'auth' ? `豆包登录已失效，图片${stage}被拒绝。`
      : kind === 'rate-limit' ? `豆包限流，图片${stage}失败。`
        : `豆包图片${stage}失败（HTTP ${code}）。`,
    { code, status: response.status, kind },
  )
}

/**
 * Upload one image for an account.
 * @returns {{attachment: object, uri: string, identifier: string}}
 */
export async function uploadImage(account, { data, mimeType, filename }, { signal } = {}) {
  const query = queryString(account)
  const headers = {
    'User-Agent': USER_AGENT,
    Origin: BASE,
    Referer: `${BASE}/chat/`,
    'agw-js-conv': 'str',
    cookie: cookieString(account),
  }
  const csrf = account.cookies?.passport_csrf_token || account.cookies?.passport_csrf_token_default
  if (csrf) headers['x-tt-passport-csrf-token'] = csrf

  const apiPost = async (path, payload, stage) => {
    const response = await fetch(`${BASE}${path}?${query}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal,
      redirect: 'manual',
    })
    if (!response.ok) await failStatus(response, stage)
    const body = parseBody(await response.text(), stage)
    const code = String(body.error_code ?? body.code ?? '')
    if (code && code !== '0' && code !== '200') {
      throw new UpstreamError(`豆包图片${stage}返回错误 ${code}。`, { code, kind: 'error' })
    }
    const payloadData = body.data
    if (!payloadData || typeof payloadData !== 'object') {
      throw new UpstreamError(`豆包图片${stage}没有返回资源数据。`, { code: 'image_no_resource' })
    }
    return payloadData
  }

  const prepared = await apiPost('/alice/resource/prepare_upload',
    { tenant_id: '5', scene_id: '5', resource_type: 2 }, '准备')
  const imagexBase = imagexHost(prepared.upload_host)
  const credentials = prepared.upload_auth_token
  const serviceId = prepared.service_id
  for (const key of ['access_key', 'secret_key', 'session_token']) {
    if (typeof credentials?.[key] !== 'string' || !credentials[key]) {
      throw new UpstreamError('豆包返回的图片上传凭证不完整。', { code: 'image_credentials_invalid' })
    }
  }

  const name = filename || 'image.png'
  const extension = name.includes('.') ? `.${name.split('.').pop()}` : '.png'
  const applyParams = {
    Action: 'ApplyImageUpload',
    Version: '2018-08-01',
    ServiceId: serviceId,
    FileSize: String(data.length),
    FileExtension: extension,
    s: randomUUID().replace(/-/g, '').slice(0, 12),
    device_platform: 'web',
  }
  const appliedResponse = await fetch(`${imagexBase}/?${imagexQuery(applyParams)}`, {
    headers: signImagexRequest('GET', applyParams, credentials),
    signal,
    redirect: 'manual',
  })
  if (!appliedResponse.ok) await failStatus(appliedResponse, '上传准备')
  const applied = parseBody(await appliedResponse.text(), '上传准备')

  const address = applied.Result?.UploadAddress
  const info = address?.StoreInfos?.[0]
  const uri = info?.StoreUri
  const sessionKey = address?.SessionKey
  const uploadAuth = info?.Auth
  if (!uri || !sessionKey || !uploadAuth || uri.startsWith('/') || uri.split('/').includes('..')) {
    throw new UpstreamError('豆包返回的图片上传地址不完整。', { code: 'image_address_invalid' })
  }
  const uploadBase = imagexHost(address.UploadHosts?.[0])

  const transferResponse = await fetch(`${uploadBase}/upload/v1/${uri.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      Authorization: uploadAuth,
      'Content-CRC32': crc32(data).toString(16).padStart(8, '0'),
      'Content-Type': 'application/octet-stream',
    },
    body: data,
    signal,
    redirect: 'manual',
  })
  if (!transferResponse.ok) await failStatus(transferResponse, '上传')
  const transferred = parseBody(await transferResponse.text(), '上传')
  if (String(transferred.code ?? 2000) !== '0' && String(transferred.code ?? 2000) !== '2000') {
    throw new UpstreamError('豆包拒绝了图片传输。', { code: 'image_transfer_rejected' })
  }

  const commitParams = { Action: 'CommitImageUpload', Version: '2018-08-01', ServiceId: serviceId }
  const commitBody = Buffer.from(JSON.stringify({ SessionKey: sessionKey }), 'utf8')
  const commitHeaders = signImagexRequest('POST', commitParams, credentials, commitBody)
  commitHeaders['Content-Type'] = 'application/json'
  const commitResponse = await fetch(`${imagexBase}/?${imagexQuery(commitParams)}`, {
    method: 'POST',
    headers: commitHeaders,
    body: commitBody,
    signal,
    redirect: 'manual',
  })
  if (!commitResponse.ok) await failStatus(commitResponse, '提交')
  const committed = parseBody(await commitResponse.text(), '提交')
  const results = committed.Result?.Results
  if (!Array.isArray(results) || !results.length || results.some((row) => row?.UriStatus !== 2000)) {
    throw new UpstreamError('豆包没有接受这张图片。', { code: 'image_commit_rejected' })
  }

  const identifier = randomUUID().replace(/-/g, '')
  const digest = createHash('md5').update(data).digest('hex')
  const registered = await apiPost('/alice/resource/register', {
    tenant_id: '5',
    scene_id: '5',
    resource_list: [{
      uri,
      resource_type: 2,
      meta: {
        image_meta: {
          data: { md5: digest, identifier },
          parse_extra: {},
          image_info: {
            file_name: name,
            format: (mimeType.split('/')[1] || 'png'),
            size: data.length,
          },
        },
      },
    }],
  }, '注册')
  const record = registered[uri]
  if (!record?.resource_id) {
    throw new UpstreamError('豆包没有为这张图片返回资源标识。', { code: 'image_register_missing' })
  }

  return {
    uri,
    identifier,
    attachment: {
      type: 1,
      identifier,
      image: {
        name,
        uri,
        image_ori: {
          url: '',
          width: 0,
          height: 0,
          format: mimeType.split('/')[1] || 'png',
          url_formats: {},
        },
      },
      parse_state: 1,
      review_state: 1,
      upload_status: 1,
      progress: 100,
      src: '',
    },
  }
}

// Kept local to avoid a second import cycle with upstream.mjs.
function queryString(account) {
  const params = {
    aid: '497858',
    real_aid: '497858',
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
    pc_version: account.clientVersion || '2.37.16',
    doubao_pc_version: account.clientVersion || '2.37.16',
    runtime: 'web',
    runtime_version: '3.4.2',
    samantha_web: '1',
    web_platform: 'desktop',
    'use-olympus-account': '1',
    client_platform: 'pc_client',
    chromium_version: '147.0.7727.149',
    channel: 'win',
    fp: account.cookies?.s_v_web_id || `verify_${account.deviceId || randomUUID()}`,
    tz_name: 'Asia/Shanghai',
    web_tab_id: randomUUID(),
  }
  return new URLSearchParams(Object.entries(params).sort()).toString()
}

function cookieString(account) {
  return Object.entries(account.cookies ?? {})
    .filter(([, value]) => typeof value === 'string' && value && !/[^\x20-\x7e]/.test(value))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}
