import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { setHandler } from '@xmcl/worker/helper'
import { getDiskInfo } from 'node-disk-info'
import Drive from 'node-disk-info/dist/classes/drive'
import { getSerializedError } from '~/infra/errors/error_serialize'

const execFileAsync = promisify(execFile)

/** Parse explicit 1 KiB POSIX df output into the byte values used by the UI. */
export function parseDarwinDiskInfo(output: string): Drive[] {
  const [header, ...lines] = output.trim().split(/\r?\n/)
  if (!header?.includes('1024-blocks')) {
    throw new Error('Unexpected macOS df output: expected 1024-byte blocks')
  }
  const drives: Drive[] = []
  for (const line of lines) {
    // Both filesystem labels and mount paths may contain spaces. Anchor the
    // numeric fields and percentage rather than assuming six whitespace tokens.
    const match = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+%)\s+(\/.*)$/.exec(line.trim())
    if (!match) continue
    const [, filesystem, blocks, used, available, capacity, mounted] = match
    const sizes = [blocks, used, available].map(value => Number(value) * 1024)
    if (!sizes.every(value => Number.isSafeInteger(value) && value >= 0)) continue
    drives.push(new Drive(filesystem, sizes[0], sizes[1], sizes[2], capacity, mounted))
  }
  return drives
}

export async function getDarwinDiskInfo(): Promise<Drive[]> {
  const { stdout } = await execFileAsync('/bin/df', ['-kP'], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  })
  return parseDarwinDiskInfo(stdout)
}

setHandler({
  getDiskInfo: async () => {
    try {
      // node-disk-info 1.3.0 returns macOS 512-byte block counts as bytes and
      // misparses filesystem labels containing spaces. Keep other OS paths intact.
      if (process.platform === 'darwin') return await getDarwinDiskInfo()
      const infos = await getDiskInfo()
      return infos
    } catch (e) {
      if (process.platform === 'win32') {
        return new Promise<Drive[]>((resolve, reject) => {
          const child = spawn("powershell.exe", ["get-psdrive -psprovider filesystem | select-object name,used,free | ConvertTo-Json"]);
          // `stdout.on('data')` chunks at the pipe buffer (~8 KB on Windows),
          // so JSON longer than one chunk arrives in multiple events. Calling
          // `JSON.parse` on each chunk yields `SyntaxError: Expected ',' or
          // '}' after property value in JSON at position N` (issue #1469 —
          // 119 users in 0.56.4). Buffer until `end`, then parse once.
          const chunks: Buffer[] = []
          child.stdout.on("data", function (data: Buffer | string) {
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
          });
          child.stdout.on("end", function () {
            const body = Buffer.concat(chunks).toString('utf-8').trim()
            if (!body) {
              resolve([])
              return
            }
            try {
              const res = JSON.parse(body, (k, v) => {
                if (k === 'Name') {
                  return v + ":"
                }
                return v
              })
              if (res instanceof Array) {
                const transformed = res.map((d: any) => new Drive('NTFS', 0, d.Used, d.Free, d.Used + d.Free, d.Name));
                resolve(transformed)
              } else if (res && typeof res === 'object') {
                // ConvertTo-Json collapses a single-element array to one
                // object. Wrap so the consumer sees a uniform list.
                resolve([new Drive('NTFS', 0, res.Used, res.Free, res.Used + res.Free, res.Name)])
              } else {
                resolve([])
              }
            } catch {
              resolve([])
            }
          });
          child.on("error", reject);
        }).catch(() => [])
      }
      throw e
    }
  }
}, getSerializedError)
