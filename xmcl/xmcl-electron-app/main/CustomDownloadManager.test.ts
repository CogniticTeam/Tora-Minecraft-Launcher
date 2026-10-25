import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, interceptors } from 'undici'
import { DefaultRangePolicy } from '@xmcl/file-transfer'
import { CustomDownloadManager, describeDownloadDestination, suggestDownloadName, validateDownloadUrl } from './CustomDownloadManager'

describe('custom files through the launcher download engine', () => {
  let server: Server, root: string, origin: string, manager: CustomDownloadManager, agent: Agent
  const payload = Buffer.alloc(1024 * 1024, 71)
  let ranges: string[], denied: boolean
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tmcl-custom-download-'))
    ranges = []; denied = true
    server = createServer((req, res) => {
      if (req.url?.startsWith('/no-head') && req.method === 'HEAD') { res.writeHead(405); res.end(); return }
      if (req.url?.startsWith('/redirect')) { res.writeHead(302, { Location: '/file.bin' }); res.end(); return }
      if (req.url?.startsWith('/forbidden') && denied) { res.writeHead(403); res.end('denied'); return }
      if (req.url?.startsWith('/missing')) { res.writeHead(404); res.end(); return }
      if (req.url?.startsWith('/slow')) {
        res.writeHead(200, { 'Content-Length': payload.length })
        let offset = 0
        const timer = setInterval(() => { const chunk = payload.subarray(offset, offset + 8192); res.write(chunk); offset += chunk.length; if (offset >= payload.length) { clearInterval(timer); res.end() } }, 5)
        res.on('close', () => clearInterval(timer))
        return
      }
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
      if (match && !req.url?.startsWith('/single')) {
        ranges.push(req.headers.range!)
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1
        res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${payload.length}`, 'Accept-Ranges': 'bytes' }); res.end(payload.subarray(start, end + 1))
      } else {
        res.writeHead(200, { 'Content-Length': payload.length, ...(!req.url?.startsWith('/single') ? { 'Accept-Ranges': 'bytes' } : {}) }); res.end(payload)
      }
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`
    agent = new Agent()
    const dispatcher = agent.compose(interceptors.redirect({ maxRedirections: 5 }))
    manager = new CustomDownloadManager(async () => ({ dispatcher, rangePolicy: new DefaultRangePolicy(65536, 4) }))
  })
  afterEach(async () => { await manager.dispose(); await agent.close(); server.close(); await once(server, 'close'); await rm(root, { recursive: true, force: true }) })
  async function finished(id: string) {
    for (let i=0;i<300;i++) { const state=manager.list().find(job=>job.id===id)!; if(!['downloading','cancelling'].includes(state.state))return state;await new Promise(resolve=>setTimeout(resolve,10)) }
    throw new Error('download did not finish')
  }
  async function started(id: string) {
    for(let i=0;i<100;i++){if(manager.list().find(job=>job.id===id)!.progress>0)return;await new Promise(resolve=>setTimeout(resolve,10))}
    throw new Error('no progress')
  }
  it('uses parallel Range requests, follows redirects, and publishes exactly the source bytes', async () => {
    const target=await describeDownloadDestination(join(root,'file.bin'))
    const job=manager.start(origin+'/redirect?secret=private',target)
    expect((await finished(job.id)).state).toBe('completed')
    expect(await readFile(target.path)).toEqual(payload)
    expect(ranges.length).toBeGreaterThan(1)
    expect(manager.list()[0].source).not.toContain('secret')
    expect((await readdir(root)).filter(name=>name.endsWith('.part'))).toEqual([])
  })
  it('falls back to a full response when the server does not support ranges', async () => {
    const job=manager.start(origin+'/single',await describeDownloadDestination(join(root,'single.bin')))
    expect((await finished(job.id)).state).toBe('completed')
    expect(await readFile(job.destination)).toEqual(payload)
  })
  it('uses the one-byte probe when HEAD is not allowed', async () => {
    const job=manager.start(origin+'/no-head',await describeDownloadDestination(join(root,'no-head.bin')))
    expect((await finished(job.id)).state).toBe('completed')
    expect(ranges).toContain('bytes=0-0')
    expect(ranges.length).toBeGreaterThan(2)
    expect(await readFile(job.destination)).toEqual(payload)
  })
  it('reports HTTP 403, preserves an existing file, and can retry successfully', async () => {
    const path=join(root,'existing.bin');await writeFile(path,'original')
    const job=manager.start(origin+'/forbidden',await describeDownloadDestination(path))
    expect(await finished(job.id)).toMatchObject({state:'failed',error:'http',httpStatus:403})
    expect(await readFile(path,'utf8')).toBe('original')
    denied=false;manager.retry(job.id)
    expect((await finished(job.id)).state).toBe('completed')
    expect(await readFile(path)).toEqual(payload)
  })
  it('reports 404 without leaving a fake finished file', async () => {
    const job=manager.start(origin+'/missing',await describeDownloadDestination(join(root,'missing.bin')))
    expect(await finished(job.id)).toMatchObject({state:'failed',httpStatus:404})
    await expect(readFile(job.destination)).rejects.toThrow()
  })
  it('cancels a live download, keeps the previous file, cleans the part, and supports retry', async () => {
    const path=join(root,'cancel.bin');await writeFile(path,'original')
    const job=manager.start(origin+'/slow',await describeDownloadDestination(path))
    await started(job.id);await manager.cancel(job.id)
    expect((await finished(job.id)).state).toBe('cancelled')
    expect(await readFile(path,'utf8')).toBe('original')
    expect((await readdir(root)).filter(name=>name.endsWith('.part'))).toEqual([])
    manager.retry(job.id)
    expect((await finished(job.id)).state).toBe('completed')
    expect(await readFile(path)).toEqual(payload)
  })
  it('does not overwrite a destination changed after the save dialog', async () => {
    const path=join(root,'changed.bin')
    const job=manager.start(origin+'/slow',await describeDownloadDestination(path))
    await started(job.id);await writeFile(path,'new external file')
    expect(await finished(job.id)).toMatchObject({state:'failed',error:'destinationChanged'})
    expect(await readFile(path,'utf8')).toBe('new external file')
  })
  it('rejects duplicate active destinations and limits concurrent jobs', async () => {
    const target=await describeDownloadDestination(join(root,'one.bin'))
    manager.start(origin+'/slow',target)
    expect(()=>manager.start(origin+'/slow',target)).toThrow('destinationBusy')
    manager.start(origin+'/slow',{path:join(root,'two.bin')});manager.start(origin+'/slow',{path:join(root,'three.bin')})
    expect(()=>manager.start(origin+'/slow',{path:join(root,'four.bin')})).toThrow('tooMany')
    await manager.dispose()
    expect(manager.list().every(job=>job.state==='cancelled')).toBe(true)
  })
})

describe('custom download URL and filename validation',()=>{
  it.each(['file:///etc/passwd','javascript:alert(1)','https://user:password@example.com/file','not a URL'])('rejects %s',value=>expect(()=>validateDownloadUrl(value)).toThrow('invalidUrl'))
  it('preserves signed query parameters but removes fragments',()=>expect(validateDownloadUrl(' https://example.com/file?token=abc#section ')).toBe('https://example.com/file?token=abc'))
  it('suggests portable filenames from encoded URLs',()=>{expect(suggestDownloadName('https://example.com/%E6%B5%8B%E8%AF%95.zip?x=1')).toBe('测试.zip');expect(suggestDownloadName('https://example.com/CON')).toBe('_CON');expect(suggestDownloadName('https://example.com/a%2Fb.zip')).toBe('a_b.zip')})
})
