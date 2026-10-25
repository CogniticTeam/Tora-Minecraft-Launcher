import { createConnection } from 'node:net'
/** End-to-end legacy Minecraft status response; never reports loopback connect time as network RTT. */
export function measureMinecraftLatency(address: string): Promise<number | undefined> {
  if (!/^127\.0\.0\.1(?::\d{1,5})?$/.test(address)) return Promise.resolve(undefined)
  const port = Number(address.split(':')[1] || 25565)
  if (port < 1024 || port > 65535) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const started = performance.now(); let settled = false
    const finish = (value?: number) => { if (settled) return; settled = true; socket.destroy(); resolve(value) }
    const socket = createConnection({ host: '127.0.0.1', port }, () => socket.write(Buffer.from([0xfe])))
    socket.once('data', data => finish(data[0] === 0xff ? Math.max(1, Math.round(performance.now() - started)) : undefined))
    socket.setTimeout(2500, () => finish()); socket.once('error', () => finish()); socket.once('end', () => finish())
  })
}
