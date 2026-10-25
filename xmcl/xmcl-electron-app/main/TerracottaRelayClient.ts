import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { parseEnvironment } from '../environmentManifest'
import type { EnvironmentManifest } from '../instanceCare'

const endpoint = 'wss://154.8.230.216/v1/terracotta/relay'
/** Raw Minecraft TCP fallback; room authentication stays inside TLS, never in URLs. */
export class TerracottaRelayClient {
  private host?: WebSocket
  private server?: Server
  private readonly sockets = new Set<Socket>()
  private readonly channels = new Set<WebSocket>()
  private readonly hostSockets = new Map<number, Socket>()
  private generation = 0
  address = ''
  available = false
  error = ''
  latencyMs?: number
  private timers = new Set<ReturnType<typeof setInterval>>()

  private hello(role: 'host' | 'guest' | 'probe' | 'watch' | 'inspect', room: string) {
    const ws = new WebSocket(endpoint); ws.addEventListener('error', () => {}); ws.binaryType = 'arraybuffer'; this.channels.add(ws)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ role, room })))
    ws.addEventListener('close', () => this.channels.delete(ws))
    return ws
  }
  private measure(ws: WebSocket) {
    let token = 0, started = 0
    const ping = () => { if (ws.readyState === WebSocket.OPEN) { token++; started = performance.now(); ws.send(JSON.stringify({type:'ping',token})) } }
    ws.addEventListener('message', event => { if(typeof event.data==='string'){try{const value=JSON.parse(event.data);if(value.type==='pong'&&value.token===token)this.latencyMs=Math.round(performance.now()-started)}catch{/* malformed control message */}} })
    ping(); const timer=setInterval(ping,5000);this.timers.add(timer)
    ws.addEventListener('close',()=>{clearInterval(timer);this.timers.delete(timer);this.latencyMs=undefined})
  }
  inspect(room: string): Promise<EnvironmentManifest | undefined> {
    const ws=this.hello('inspect',room)
    return new Promise((resolve,reject)=>{
      const chunks:string[]=[];let settled=false
      const finish=(value?:EnvironmentManifest,error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);ws.close();if(error)reject(error);else resolve(value)}
      const timer=setTimeout(()=>finish(undefined,new Error('环境清单读取超时。')),10000)
      ws.addEventListener('close',()=>{if(!settled)finish(undefined,new Error('房主未共享环境清单，或房间已关闭。'))})
      ws.addEventListener('error',()=>finish(undefined,new Error('无法连接环境检查服务。')))
      ws.addEventListener('message',event=>{try{if(typeof event.data!=='string')throw new Error();const value=JSON.parse(event.data);if(value.type==='environment-unavailable'){finish();return}if(value.type!=='environment-part'||value.index!==chunks.length||!Number.isInteger(value.total)||value.total<1||value.total>64||typeof value.text!=='string'||value.text.length>12000)throw new Error();chunks.push(value.text);if(chunks.join('').length>524288)throw new Error();if(chunks.length===value.total)finish(parseEnvironment(JSON.parse(chunks.join(''))))}catch{finish(undefined,new Error('房主环境清单格式无效。'))}})
    })
  }
  private ready(ws: WebSocket) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); ws.close(); reject(new Error('TMCL 中继连接超时，请重试。')) }, 10000)
      const closed = () => { cleanup(); reject(new Error('TMCL 中继未连接，房间可能已关闭。')) }
      const message = (event: MessageEvent) => { if (typeof event.data === 'string') { try { if (JSON.parse(event.data).type === 'ready') { cleanup(); resolve() } } catch { /* bounded server control messages */ } } }
      const cleanup = () => { clearTimeout(timer); ws.removeEventListener('close', closed); ws.removeEventListener('error', closed); ws.removeEventListener('message', message) }
      ws.addEventListener('close', closed); ws.addEventListener('error', closed); ws.addEventListener('message', message)
    })
  }
  private send(ws: WebSocket, bytes: Buffer) {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(); return }
    for (let offset = 0; offset < bytes.length; offset += 64000) ws.send(new Uint8Array(bytes.subarray(offset, offset + 64000)))
  }
  async serve(room: string, port: number, environment?: EnvironmentManifest) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('局域网游戏端口无效。')
    const generation = this.generation, ws = this.hello('host', room); this.host = ws
    ws.addEventListener('message', event => {
      if (generation !== this.generation) return
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data)
        if (!Number.isInteger(data.id)) return
        if (data.type === 'close') { this.hostSockets.get(data.id)?.destroy(); return }
        if (data.type !== 'open' || this.hostSockets.size >= 64) return
        const socket = createConnection({ host: '127.0.0.1', port }); this.sockets.add(socket); this.hostSockets.set(data.id, socket)
        socket.once('connect', () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ready', id: data.id })) })
        socket.on('data', bytes => { for (let n = 0; n < bytes.length; n += 60000) { const frame = Buffer.allocUnsafe(4 + Math.min(60000, bytes.length - n)); frame.writeUInt32BE(data.id); bytes.copy(frame, 4, n, n + 60000); this.send(ws, frame) } })
        socket.on('error', () => socket.destroy())
        socket.once('close', () => { this.sockets.delete(socket); this.hostSockets.delete(data.id); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'close', id: data.id })) })
      } else {
        const bytes = Buffer.from(event.data as ArrayBuffer)
        if (bytes.length < 4) return
        const socket = this.hostSockets.get(bytes.readUInt32BE())
        if (socket && socket.writableLength < 2 * 1024 * 1024) socket.write(bytes.subarray(4)); else socket?.destroy()
      }
    })
    ws.addEventListener('close', () => { this.available = false; for (const socket of this.hostSockets.values()) socket.destroy() })
    await this.ready(ws)
    if (generation !== this.generation) { ws.close(); return }
    this.available = true
    this.measure(ws)
    if(environment){const text=JSON.stringify(parseEnvironment(environment));if(Buffer.byteLength(text)>524288)throw new Error('环境清单超过 512 KB。');const total=Math.ceil(text.length/12000);for(let index=0;index<total;index++)ws.send(JSON.stringify({type:'environment-part',index,total,text:text.slice(index*12000,(index+1)*12000)}))}
  }
  async join(room: string) {
    const generation = this.generation, probe = this.hello('watch', room)
    await this.ready(probe)
    this.measure(probe)
    if (probe.readyState !== WebSocket.OPEN) throw new Error('房间已关闭。')
    if (generation !== this.generation) throw new Error('联机操作已取消。')
    const server = createServer(socket => {
      socket.pause(); this.sockets.add(socket)
      const ws = this.hello('guest', room)
      ws.addEventListener('message', event => { if (typeof event.data !== 'string') { if (socket.writableLength < 2 * 1024 * 1024) socket.write(Buffer.from(event.data as ArrayBuffer)); else socket.destroy() } })
      ws.addEventListener('close', () => socket.destroy()); ws.addEventListener('error', () => socket.destroy())
      socket.on('data', bytes => this.send(ws, bytes)); socket.on('error', () => socket.destroy())
      socket.once('close', () => { this.sockets.delete(socket); ws.close() })
      void this.ready(ws).then(() => socket.resume(), () => socket.destroy())
    })
    this.server = server
    probe.addEventListener('close', () => { if (generation === this.generation) { this.error = '房主已离开，或与中继服务器的连接中断。'; this.address = ''; server.close(); for (const socket of this.sockets) socket.destroy() } })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    this.address = '127.0.0.1:' + (server.address() as { port: number }).port
    return this.address
  }
  stop() {
    this.generation++; this.error = ''; this.available = false; this.address = ''
    this.latencyMs=undefined;for(const timer of this.timers)clearInterval(timer);this.timers.clear()
    for (const channel of this.channels) channel.close()
    for (const socket of this.sockets) socket.destroy()
    this.server?.close(); this.server = undefined; this.host = undefined; this.hostSockets.clear()
  }
}
