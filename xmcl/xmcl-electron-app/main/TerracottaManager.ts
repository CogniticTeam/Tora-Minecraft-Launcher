import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile, rename, chmod, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { extract } from 'tar-stream'
import type { TerracottaSnapshot } from '../terracotta'
import { TerracottaRelayClient } from './TerracottaRelayClient'
import { compareEnvironments } from '../environmentManifest'
import type { EnvironmentManifest } from '../instanceCare'
import { measureMinecraftLatency } from './minecraftLatency'
import { terracottaArtifacts } from './terracottaArtifacts'

const version = '0.4.2'
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const exceptionMessages = ['无法连接房主，请确认房间仍然开放。', '与房主的连接中断。', '加入方联机组件异常退出。', '房主联机组件异常退出。', '房主已退出存档，房间已关闭。', '联机协议异常，请重试。']

export function normalizeRoom(input: unknown): string {
  if (typeof input !== 'string' || input.length > 64) throw new Error('请输入有效的陶瓦房间码。')
  const room = input.trim().toUpperCase()
  if (!/^U\/[0-9A-HJ-NP-Z]{4}(?:-[0-9A-HJ-NP-Z]{4}){3}$/.test(room)) throw new Error('房间码格式为 U/XXXX-XXXX-XXXX-XXXX。')
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let value = 0n, factor = 1n
  for (const ch of room.slice(2).replaceAll('-', '')) { value += BigInt(alphabet.indexOf(ch)) * factor; factor *= 34n }
  if (value % 7n !== 0n) throw new Error('房间码校验失败，请重新复制完整房间码。')
  return room
}

/** Deliberately uses node:http: localhost control traffic must never enter a proxy. */
export function localRequest(port: number, path: string): Promise<string> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !path.startsWith('/')) return Promise.reject(new Error('联机控制端口无效。'))
  return new Promise((resolve, reject) => {
    const req = get({ hostname: '127.0.0.1', port, path, timeout: 4000, agent: false }, response => {
      if (response.statusCode !== 200 && response.statusCode !== 204) { response.resume(); reject(new Error('联机组件未接受请求，请检查房间状态。')); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024) req.destroy(new Error('联机组件响应过大。')); else chunks.push(chunk) })
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      response.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('联机组件响应超时。')))
    req.on('error', reject)
  })
}

async function extractBinary(archive: Buffer, name: string): Promise<Buffer> {
  const tar = extract(); let binary: Buffer | undefined
  tar.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = []; let size = 0
    stream.on('data', (b: Buffer) => { if (header.name === name) { size += b.length; if (size > 64 * 1024 * 1024) tar.destroy(new Error('联机组件体积异常。')); else chunks.push(b) } })
    stream.on('end', () => { if (header.name === name && header.type === 'file') binary = Buffer.concat(chunks); next() })
    stream.on('error', error => tar.destroy(error))
  })
  const finished = new Promise<void>((resolve, reject) => { tar.on('finish', resolve); tar.on('error', reject) })
  tar.end(gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 }))
  await finished
  if (!binary) throw new Error('安装包未包含所需的联机组件。')
  return binary
}

export class TerracottaManager {
  private readonly relay = new TerracottaRelayClient()
  private relayRoom = ''
  private joiningRoom = ''
  private joiningSince = 0
  private fallbackStarting = false
  private relayRetryAt = 0
  private relayServing = false
  private joiningDeadline = 0
  private environment?: EnvironmentManifest
  private gameLatencyMs?: number
  private lastLatencyCheck = 0
  private latencyChecking = false
  private port = 0
  private child?: ChildProcess
  private ownsProcess = false
  private preparing?: Promise<TerracottaSnapshot>
  private changing = false
  private phase: TerracottaSnapshot['phase'] = 'missing'
  private lastError = ''
  private last: TerracottaSnapshot = { phase: 'missing', state: 'waiting', index: -1, version, profiles: [] }

  constructor(private readonly directory: string, private readonly download: (url: string, init?: RequestInit) => Promise<Response>, private readonly platform = process.platform, private readonly arch = process.arch) {}

  private artifact() {
    const os = ({ darwin: 'macos', win32: 'windows', linux: 'linux' } as Record<string, string>)[this.platform]
    const cpu = ({ arm64: 'arm64', x64: 'x86_64' } as Record<string, string>)[this.arch]
    const name = `terracotta-${version}-${os}-${cpu}-pkg.tar.gz`
    const artifact = terracottaArtifacts[name]
    if (!artifact) throw new Error('陶瓦联机暂不支持当前系统或处理器。')
    return { name, ...artifact }
  }

  async status(): Promise<TerracottaSnapshot> {
    if (this.relay.address) { this.checkLatency(this.relay.address); return { phase: 'ready', state: 'guest-ok', index: this.last.index + 1, version, room: this.joiningRoom, address: this.relay.address, transport: 'relay', relayLatencyMs:this.relay.latencyMs,gameLatencyMs:this.gameLatencyMs, profiles: [] } }
    if (this.joiningRoom && this.fallbackStarting && this.relay.error) { this.lastError = this.relay.error; this.joiningRoom = ''; this.last = { ...this.last, state: 'exception', error: this.relay.error }; return { ...this.last } }
    if (!this.port) return { ...this.last, phase: this.phase, error: this.lastError || undefined }
    try {
      const value = JSON.parse(await localRequest(this.port, '/state'))
      if (!Number.isSafeInteger(value.index) || typeof value.state !== 'string') throw new Error()
      if (value.index >= this.last.index) {
        this.last = { phase: 'ready', version, state: value.state, index: value.index,
          room: typeof value.room === 'string' ? value.room.slice(0, 64) : undefined,
          address: typeof value.url === 'string' && /^127\.0\.0\.1(?::\d{1,5})?$/.test(value.url) ? value.url : undefined,
          difficulty: typeof value.difficulty === 'string' ? value.difficulty : undefined,
          error: value.state === 'exception' ? exceptionMessages[value.type] || '联机组件发生异常，请重试。' : undefined,
          profiles: Array.isArray(value.profiles) ? value.profiles.slice(0, 64).map((p: { name?: string; kind?: string }) => ({ name: String(p.name || '玩家').slice(0, 64), kind: String(p.kind || '') })) : [] }
      }
      if (value.state === 'host-ok' && this.last.room && (!this.relay.available && !this.relayServing) && Date.now() > this.relayRetryAt) {
        const room = this.last.room; this.relayRoom = room; this.relayServing = true
        void this.startHostRelay(room).catch(() => { this.relayRoom = ''; this.relayRetryAt = Date.now() + 15000 }).finally(() => { this.relayServing = false })
      }
      if (this.joiningRoom && Date.now() > this.joiningDeadline && value.state !== 'guest-ok') {
        this.joiningRoom = ''; this.lastError = '连接超时，请确认房主仍在游戏中，双方使用最新 TMCL 后重试。'; await localRequest(this.port, '/state/ide'); this.last = { ...this.last, state: 'exception', error: this.lastError }; return { ...this.last }
      }
      if (this.joiningRoom && value.state !== 'guest-ok' && Date.now() - this.joiningSince > 6000 && !this.fallbackStarting) {
        this.fallbackStarting = true
        void this.relay.join(this.joiningRoom).then(async () => { await localRequest(this.port, '/state/ide').catch(() => {}) }).catch(() => { this.fallbackStarting = false; this.joiningSince = Date.now() })
      }
      if(value.state==='guest-ok'&&this.last.address)this.checkLatency(this.last.address)
      return { ...this.last, transport:value.state==='guest-ok'?'direct':undefined, error: this.last.error || this.lastError || undefined, relayAvailable: this.relay.available, relayLatencyMs:this.relay.latencyMs,gameLatencyMs:this.gameLatencyMs }
    } catch { this.port = 0; this.phase = 'error'; this.lastError = '联机组件连接中断，请重新连接。'; return { ...this.last, phase: 'error', error: this.lastError } }
  }

  private async startHostRelay(room: string) {
    const log = await localRequest(this.port, '/log?fetch=true')
    const ports = [...log.matchAll(/AppState::HostStarting[^\n]*port: (\d+)/g)]
    const port = Number(ports.at(-1)?.[1])
    if (!port) throw new Error('未找到局域网游戏端口。')
    await this.relay.serve(room, port, this.environment)
  }

  setEnvironment(environment?:EnvironmentManifest){this.environment=environment}
  private checkLatency(address:string){if(this.latencyChecking||Date.now()-this.lastLatencyCheck<15000)return;this.lastLatencyCheck=Date.now();this.latencyChecking=true;void measureMinecraftLatency(address).then(ms=>{this.gameLatencyMs=ms}).finally(()=>{this.latencyChecking=false})}
  async inspect(room:string,local?:EnvironmentManifest){const normalized=normalizeRoom(room);try{const remote=await this.relay.inspect(normalized);return{local,remote,differences:remote&&local?compareEnvironments(local,remote):[],warning:!remote?'房主未共享环境清单。':!local?'未选择本地实例，无法对比环境。':undefined}}catch(e){return{local,differences:[],warning:e instanceof Error?e.message:'无法读取环境信息。'}}}

  prepare() {
    if (!this.preparing) this.preparing = this.start().finally(() => { this.preparing = undefined })
    return this.preparing
  }

  private async start(): Promise<TerracottaSnapshot> {
    if (this.port && (await this.status()).phase === 'ready') return this.status()
    try {
      const artifact = this.artifact()
      this.lastError = ''; this.phase = 'downloading'
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const binaryPath = join(this.directory, this.platform === 'win32' ? 'terracotta.exe' : 'terracotta')
      const cached = await readFile(binaryPath).catch(() => undefined)
      const extraFilesValid = (await Promise.all(Object.entries(artifact.files).map(async ([name, digest]) => sha256(await readFile(join(this.directory, name)).catch(() => Buffer.alloc(0))) === digest))).every(Boolean)
      if (!cached || sha256(cached) !== artifact.binarySha256 || !extraFilesValid) {
        const url = `https://154.8.230.216/components/terracotta/${artifact.name}`
        const response = await this.download(url, { signal: AbortSignal.timeout(120000), redirect: 'error' })
        if (!response.ok || !response.body) throw new Error('联机组件下载失败，请检查网络后重试。')
        const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0
        while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > artifact.size) { await reader.cancel(); throw new Error('联机组件体积校验失败。') } chunks.push(Buffer.from(r.value)) }
        const archive = Buffer.concat(chunks)
        if (sha256(archive) !== artifact.archiveSha256) throw new Error('联机组件完整性校验失败，请重试。')
        const binary = await extractBinary(archive, artifact.binary)
        if (sha256(binary) !== artifact.binarySha256) throw new Error('联机程序完整性校验失败。')
        for (const [name, digest] of Object.entries(artifact.files)) {
          const bytes = await extractBinary(archive, name)
          if (sha256(bytes) !== digest) throw new Error('联机运行库完整性校验失败。')
          await writeFile(join(this.directory, name + '.new'), bytes, { mode: 0o600 }); await rename(join(this.directory, name + '.new'), join(this.directory, name))
        }
        await writeFile(binaryPath + '.new', binary, { mode: 0o700 }); await rename(binaryPath + '.new', binaryPath)
      }
      await chmod(binaryPath, 0o700)
      this.phase = 'starting'; this.last = { ...this.last, index: -1 }
      const portFile = join(this.directory, 'port.json')
      const lock = join(this.platform === 'darwin' ? join(homedir(), 'terracotta') : join(tmpdir(), 'terracotta'), 'terracotta.lock')
      // Reuse an existing upstream instance only after validating its metadata.
      try { const bytes = await readFile(lock); const port = bytes.readUInt16BE(); const meta = JSON.parse(await localRequest(port, '/meta')); if (meta.version === version) this.port = port } catch { /* no running instance */ }
      if (!this.port) {
        await rm(portFile, { force: true })
        this.child = spawn(binaryPath, this.platform === 'darwin' ? ['--daemon'] : ['--hmcl', portFile], { cwd: this.directory, windowsHide: true, stdio: 'ignore' })
        let processError = false
        this.child.once('error', () => { processError = true })
        this.ownsProcess = true
        for (let i = 0; i < 150 && !this.port; i++) {
          if (processError) throw new Error('无法启动陶瓦组件，请检查系统是否阻止运行。')
          try {
            const port = this.platform === 'darwin' ? (await readFile(lock)).readUInt16BE() : JSON.parse(await readFile(portFile, 'utf8')).port
            const meta = JSON.parse(await localRequest(port, '/meta'))
            if (meta.version === version) this.port = port
          } catch { /* wait for the component to publish its loopback port */ }
          if (!this.port) await wait(200)
        }
      }
      if (!this.port) throw new Error('陶瓦组件启动超时，请重试。')
      this.phase = 'ready'; return this.status()
    } catch (e) {
      if (this.ownsProcess) this.child?.kill()
      this.ownsProcess = false; this.phase = 'error'; this.lastError = e instanceof Error ? e.message : '联机组件启动失败。'
      throw new Error(this.lastError)
    }
  }

  async change(action: 'host' | 'join' | 'leave', player = '', input = '') {
    if (this.changing) throw new Error('正在处理上一个联机操作。')
    if (typeof player !== 'string' || player.length > 64 || Array.from(player).some(c => c.charCodeAt(0) < 32)) throw new Error('玩家名称无效。')
    const room = action === 'join' ? normalizeRoom(input) : ''
    this.changing = true
    try {
      await this.prepare()
      const current = await this.status()
      if (action === 'leave') { this.relay.stop(); this.relayRoom = ''; this.joiningRoom = ''; this.fallbackStarting = false; await localRequest(this.port, '/state/ide'); return this.status() }
      if (current.state !== 'waiting' && current.state !== 'exception') throw new Error('请先退出当前房间。')
      if (current.state === 'exception') await localRequest(this.port, '/state/ide')
      this.relay.stop(); this.relayRoom = ''; this.joiningRoom = action === 'join' ? room : ''; this.joiningSince = Date.now(); this.joiningDeadline = Date.now() + 45000; this.lastError = ''; this.fallbackStarting = false
      const query = new URLSearchParams({ player: player.trim() || 'TMCL 玩家', public_nodes: 'wss://154.8.230.216/terracotta' })
      if (room) query.set('room', room)
      await localRequest(this.port, `/state/${action === 'host' ? 'scanning' : 'guesting'}?${query}`)
      return this.status()
    } finally { this.changing = false }
  }

  get needsShutdown() { return this.ownsProcess || Boolean(this.relayRoom || this.joiningRoom) }

  async dispose() {
    this.relay.stop(); this.joiningRoom = ''; this.relayRoom = ''
    if (!this.ownsProcess) return
    try { if (this.port) await localRequest(this.port, '/panic?peaceful=true') } catch { /* already stopped */ }
    this.child?.kill(); this.port = 0; this.ownsProcess = false
  }
}
