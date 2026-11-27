/**
 * Windows DPAPI, without a native module.
 *
 * Chromium protects its cookie AES key with DPAPI under the current user. Node
 * has no binding for it, so this shells out to PowerShell's
 * ProtectedData.Unprotect and reads back the key as hex. Nothing but the key
 * leaves the child process, and the key never touches disk.
 */
import { spawn } from 'node:child_process'

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Convert]::FromBase64String($env:DSW_DPAPI_BLOB)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, 'CurrentUser')
[Console]::Out.Write(($plain | ForEach-Object { $_.ToString('x2') }) -join '')
`

/** Unprotect one DPAPI blob (Buffer) for the current Windows user. */
export function unprotect(blob) {
  return run(SCRIPT, { DSW_DPAPI_BLOB: Buffer.from(blob).toString('base64') })
}

function run(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      env: { ...process.env, ...env },
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => reject(new Error(`无法启动 PowerShell 以解读本机密钥：${error.message}`)))
    child.on('close', (code) => {
      const hex = out.trim()
      if (code !== 0) {
        reject(new Error(`DPAPI 解保护失败（PowerShell 退出码 ${code}）：${err.trim().slice(0, 300) || '无输出'}`))
        return
      }
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
        reject(new Error('DPAPI 解保护没有返回二进制密钥。'))
        return
      }
      resolve(Buffer.from(hex, 'hex'))
    })
  })
}
