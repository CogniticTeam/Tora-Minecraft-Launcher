import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TerracottaManager, localRequest, normalizeRoom } from './TerracottaManager'

describe('Terracotta integration boundary', () => {
  it('validates the actual protocol room checksum before connecting', () => {
    expect(normalizeRoom(' u/ynze-u61d-2206-hxrg ')).toBe('U/YNZE-U61D-2206-HXRG')
    for (const input of ['', 'https://example.com', 'U/YNZE-U61D-2206-HXRI', 'U/YNZE-U61D-2206-HXRH', '../port.json']) expect(() => normalizeRoom(input)).toThrow()
  })
  it('controls only a loopback service and rejects bad status codes', async () => {
    const server = createServer((req, res) => { res.writeHead(req.url === '/state' ? 200 : 400); res.end('{"state":"waiting","index":0}') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try { expect(JSON.parse(await localRequest(port, '/state')).state).toBe('waiting'); await expect(localRequest(port, '/bad')).rejects.toThrow(); await expect(localRequest(80, '/state')).rejects.toThrow() }
    finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('refuses corrupted components before extracting or executing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tmcl-terracotta-test-'))
    const manager = new TerracottaManager(dir, async () => new Response('corrupted archive'), 'darwin', 'arm64')
    try { await expect(manager.prepare()).rejects.toThrow('完整性校验失败'); expect((await manager.status()).phase).toBe('error') }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('rejects unsupported systems without downloading', async () => {
    const manager = new TerracottaManager('/unused', async () => { throw new Error('must not download') }, 'freebsd', 'x64')
    await expect(manager.prepare()).rejects.toThrow('暂不支持')
  })
})
