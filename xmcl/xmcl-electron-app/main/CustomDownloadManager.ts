import { download, getDownloadBaseOptions, ProgressTrackerSingle, type DownloadBaseOptions } from '@xmcl/file-transfer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, lstat, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CustomDownload } from '../customDownloads'

type Fingerprint = { ino: number; dev: number; size: number; mtimeMs: number }
export interface DownloadDestination { path: string; previous?: Fingerprint }
interface Job {
  state: CustomDownload
  url: string
  target: DownloadDestination
  controller: AbortController
  tracker: ProgressTrackerSingle
  promise?: Promise<void>
  sampledAt: number
  sampledBytes: number
}

export function validateDownloadUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('invalidUrl')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('invalidUrl') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('invalidUrl')
  url.hash = ''
  return url.href
}

export function suggestDownloadName(value: string) {
  const url = new URL(validateDownloadUrl(value))
  let name = url.pathname.split('/').at(-1) || 'download'
  try { name = decodeURIComponent(name) } catch { /* keep an undecodable URL segment */ }
  name = Array.from(name).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('')
    .replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 180)
  if (!name || name === '.' || name === '..') name = 'download'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name
}

async function fingerprint(path: string): Promise<Fingerprint | undefined> {
  const entry = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (!entry) return undefined
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('invalidDestination')
  return { ino: entry.ino, dev: entry.dev, size: entry.size, mtimeMs: entry.mtimeMs }
}

export async function describeDownloadDestination(path: string): Promise<DownloadDestination> {
  const canonical = join(await realpath(dirname(path)), basename(path))
  return { path: canonical, previous: await fingerprint(canonical) }
}

function failure(error: unknown): { error: string; httpStatus?: number } {
  const queue: unknown[] = [error]
  for (let i = 0; i < queue.length && i < 16; i++) {
    const item = queue[i] as { statusCode?: number; code?: string; cause?: unknown; errors?: unknown[] }
    if (!item || typeof item !== 'object') continue
    if (item.statusCode) return { error: 'http', httpStatus: item.statusCode }
    if (item.code === 'ENOSPC') return { error: 'diskFull' }
    if (['EACCES', 'EPERM', 'EROFS'].includes(item.code || '')) return { error: 'permission' }
    if (item.code === 'EEXIST' || (item as Error).message === 'destinationChanged') return { error: 'destinationChanged' }
    if (item.cause) queue.push(item.cause)
    if (Array.isArray(item.errors)) queue.push(...item.errors)
  }
  return { error: 'network' }
}

export class CustomDownloadManager {
  private readonly jobs = new Map<string, Job>()
  private disposed = false
  constructor(private readonly options: () => Promise<DownloadBaseOptions>) {}

  list(): CustomDownload[] {
    const now = Date.now()
    return [...this.jobs.values()].reverse().map(job => {
      if (job.state.state === 'downloading') {
        job.state.progress = job.tracker.progress
        job.state.total = job.tracker.total
        if (now - job.sampledAt >= 250) {
          job.state.speed = Math.max(0, (job.state.progress - job.sampledBytes) / ((now - job.sampledAt) / 1000))
          job.sampledAt = now
          job.sampledBytes = job.state.progress
        }
      }
      return { ...job.state }
    })
  }

  private checkCapacity(path: string) {
    if (this.disposed) throw new Error('unavailable')
    const active = [...this.jobs.values()].filter(job => ['downloading', 'cancelling'].includes(job.state.state))
    if (active.some(job => job.state.destination === path)) throw new Error('destinationBusy')
    if (active.length >= 3) throw new Error('tooMany')
  }

  start(value: string, target: DownloadDestination): CustomDownload {
    const url = validateDownloadUrl(value)
    this.checkCapacity(target.path)
    while (this.jobs.size >= 50) {
      const old = [...this.jobs.values()].find(job => !['downloading', 'cancelling'].includes(job.state.state))
      if (!old) break
      this.jobs.delete(old.state.id)
    }
    const parsed = new URL(url)
    const state: CustomDownload = { id: randomUUID(), name: basename(target.path), source: parsed.origin + parsed.pathname,
      destination: target.path, state: 'downloading', progress: 0, total: 0, speed: 0, started: Date.now() }
    const job: Job = { state, url, target, controller: new AbortController(), tracker: new ProgressTrackerSingle(), sampledAt: Date.now(), sampledBytes: 0 }
    this.jobs.set(state.id, job)
    job.promise = this.execute(job)
    return { ...state }
  }

  async cancel(id: string) {
    const job = this.get(id)
    if (job.state.state !== 'downloading') return
    job.state.state = 'cancelling'
    job.controller.abort()
    await job.promise
  }

  retry(id: string) {
    const job = this.get(id)
    if (!['failed', 'cancelled'].includes(job.state.state)) throw new Error('invalidAction')
    this.checkCapacity(job.target.path)
    Object.assign(job.state, { state: 'downloading', progress: 0, total: 0, speed: 0, error: undefined, httpStatus: undefined, started: Date.now() })
    job.controller = new AbortController()
    job.tracker = new ProgressTrackerSingle()
    job.sampledAt = Date.now(); job.sampledBytes = 0
    job.promise = this.execute(job)
    return { ...job.state }
  }

  completedPath(id: string) {
    const job = this.get(id)
    if (job.state.state !== 'completed') throw new Error('invalidAction')
    return job.state.destination
  }

  private get(id: string) {
    if (typeof id !== 'string' || !this.jobs.has(id)) throw new Error('notFound')
    return this.jobs.get(id)!
  }

  private async execute(job: Job) {
    // Keep the user's previous file intact until a complete download is ready.
    const stage = join(dirname(job.target.path), `.tmcl-download-${randomUUID()}.part`)
    try {
      const options = await this.options()
      job.controller.signal.throwIfAborted()
      const expectedTotal = await this.contentLength(job.url, options, job.controller.signal)
      await download({ ...options, url: job.url, destination: stage, expectedTotal, tracker: job.tracker, signal: job.controller.signal })
      job.controller.signal.throwIfAborted()
      const current = await fingerprint(job.target.path)
      if (JSON.stringify(current) !== JSON.stringify(job.target.previous)) throw new Error('destinationChanged')
      job.controller.signal.throwIfAborted()
      if (job.target.previous) await rename(stage, job.target.path)
      else {
        try { await link(stage, job.target.path) } catch (error) {
          if (!['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) throw error
          await copyFile(stage, job.target.path, constants.COPYFILE_EXCL)
        }
      }
      const size = (await stat(job.target.path)).size
      Object.assign(job.state, { state: 'completed', progress: size, total: size, speed: 0 })
    } catch (error) {
      Object.assign(job.state, job.controller.signal.aborted ? { state: 'cancelled', speed: 0 } : { state: 'failed', speed: 0, ...failure(error) })
    } finally { await rm(stage, { force: true }).catch(() => {}) }
  }

  private async contentLength(value: string, options: DownloadBaseOptions, signal: AbortSignal) {
    const url = new URL(value), { dispatcher } = getDownloadBaseOptions(options)
    // A known size lets the existing engine issue parallel byte ranges. Some
    // sites reject HEAD, so try a one-byte range before falling back to GET.
    for (const method of ['HEAD', 'GET'] as const) {
      signal.throwIfAborted()
      try {
        const response = await dispatcher.request({ origin: url.origin, path: url.pathname + url.search, method,
          headers: method === 'GET' ? { Range: 'bytes=0-0' } : {}, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })
        try {
          if (response.statusCode < 200 || response.statusCode >= 300) continue
          const size = response.statusCode === 206
            ? Number(/\/(\d+)$/.exec(String(response.headers['content-range']))?.[1])
            : Number(response.headers['content-length'])
          if (Number.isSafeInteger(size) && size > 0) return size
        } finally {
          // A GET probe may have received a full response from a server that
          // ignores Range. Stop that body without an unhandled abort event.
          response.body.on('error', () => {})
          response.body.destroy()
        }
      } catch { signal.throwIfAborted() }
    }
    return undefined
  }

  async dispose() {
    this.disposed = true
    for (const job of this.jobs.values()) if (job.state.state === 'downloading') job.controller.abort()
    await Promise.all([...this.jobs.values()].map(job => job.promise))
  }
}
