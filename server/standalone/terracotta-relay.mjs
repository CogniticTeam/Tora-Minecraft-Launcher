import { createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { parseEnvironment } from '../../xmcl/xmcl-electron-app/environmentManifest.ts';

const hash = room => createHash('sha256').update(room).digest('hex');
const validRoom = room => typeof room === 'string' && /^U\/[0-9A-HJ-NP-Z]{4}(?:-[0-9A-HJ-NP-Z]{4}){3}$/.test(room);
/** Room-code protected TCP carrier. Never accepts destinations or exposes host-network sockets. */
export class TerracottaRelay {
  constructor() {
    this.rooms = new Map(); this.attempts = new Map(); this.sequence = 0;
    this.server = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
    this.server.on('connection', ws => this.connect(ws));
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [ip, limit] of this.attempts) if (now - limit.since > 60000) this.attempts.delete(ip);
      for (const ws of this.server.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    }, 20000); this.sweep.unref();
  }
  upgrade(req, socket, head) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.remoteAddress;
    const now = Date.now(), limit = this.attempts.get(ip) || { since: now, count: 0 };
    if (now - limit.since > 60000) { limit.since = now; limit.count = 0; }
    limit.count++; this.attempts.set(ip, limit);
    if (limit.count > 120 || this.server.clients.size >= 256 || this.attempts.size > 10000) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
    this.server.handleUpgrade(req, socket, head, ws => this.server.emit('connection', ws));
  }
  send(ws, data) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'relay_busy'); return; }
    ws.send(data);
  }
  connect(ws) {
    ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {});
    let room, role, id;
    let bytes = 0, window = Date.now();
    const deadline = setTimeout(() => ws.close(1008, 'authentication_required'), 5000); deadline.unref();
    ws.on('message', (raw, binary) => {
      try {
        if (Date.now() - window > 1000) { bytes = 0; window = Date.now(); }
        bytes += raw.length;
        if (bytes > 4 * 1024 * 1024) { ws.close(1013, 'rate_limited'); return; }
        if (!role) {
          if (binary || raw.length > 256) throw new Error();
          const hello = JSON.parse(raw.toString());
          if (!validRoom(hello.room) || !['host', 'guest', 'probe', 'watch', 'inspect'].includes(hello.role)) throw new Error();
          const key = hash(hello.room); clearTimeout(deadline); role = hello.role;
          if (role === 'host') {
            if (this.rooms.has(key) || this.rooms.size >= 32) { ws.close(1008, 'room_unavailable'); return; }
            room = { key, host: ws, guests: new Map(), watchers: new Set(), environment: null, parts: [] }; this.rooms.set(key, room); this.send(ws, JSON.stringify({ type: 'ready' }));
          } else {
            room = this.rooms.get(key);
            if (!room || room.host.readyState !== WebSocket.OPEN) { ws.close(1008, 'room_not_found'); return; }
            if (role === 'inspect') {
              if (!room.environment) this.send(ws, JSON.stringify({type:'environment-unavailable'}));
              else { const text=JSON.stringify(room.environment), total=Math.ceil(text.length/12000);for(let index=0;index<total;index++)this.send(ws,JSON.stringify({type:'environment-part',index,total,text:text.slice(index*12000,(index+1)*12000)})); }
              ws.close(1000); return;
            }
            if (role === 'watch') { room.watchers.add(ws); this.send(ws, JSON.stringify({type:'ready'})); return; }
            if (role === 'probe') { this.send(ws, JSON.stringify({ type: 'ready' })); ws.close(1000); return; }
            if (room.guests.size >= 64) { ws.close(1013, 'room_full'); return; }
            id = (this.sequence = (this.sequence % 0xfffffffe) + 1); room.guests.set(id, ws);
            this.send(room.host, JSON.stringify({ type: 'open', id }));
          }
          return;
        }
        if (!room || role === 'probe') return;
        if (!binary && raw.length < 128) { const ping=JSON.parse(raw.toString());if(ping.type==='ping'&&Number.isSafeInteger(ping.token)){this.send(ws,JSON.stringify({type:'pong',token:ping.token}));return;} }
        if (role === 'watch' || role === 'inspect') throw new Error();
        if (binary) {
          if (role === 'guest') { if (raw.length > 65532) throw new Error(); const frame = Buffer.allocUnsafe(4 + raw.length); frame.writeUInt32BE(id); raw.copy(frame, 4); this.send(room.host, frame); }
          else { if (raw.length < 4) throw new Error(); const target = room.guests.get(raw.readUInt32BE()); if (target) this.send(target, raw.subarray(4)); }
        } else if (role === 'host' && raw.length < 65536) {
          const message = JSON.parse(raw.toString()), guest = room.guests.get(message.id);
          if(message.type==='environment-part'){
            if(!Number.isInteger(message.index)||!Number.isInteger(message.total)||message.total<1||message.total>64||message.index!==room.parts.length||typeof message.text!=='string'||message.text.length>12000)throw new Error();
            room.parts.push(message.text);if(Buffer.byteLength(room.parts.join(''))>524288)throw new Error();
            if(room.parts.length===message.total){room.environment=parseEnvironment(JSON.parse(room.parts.join('')));room.parts=[];}return;
          }
          if (guest && message.type === 'ready') this.send(guest, JSON.stringify({ type: 'ready' }));
          else if (guest && message.type === 'close') guest.close(1000);
        } else throw new Error();
      } catch { ws.close(1008, 'invalid_message'); }
    });
    ws.on('close', () => {
      clearTimeout(deadline);
      if (!room) return;
      if (role === 'host' && room.host === ws) { this.rooms.delete(room.key); for (const guest of [...room.guests.values(), ...room.watchers]) guest.close(1001, 'host_left'); }
      else if (role === 'watch') room.watchers.delete(ws);
      else if (role === 'guest') { room.guests.delete(id); this.send(room.host, JSON.stringify({ type: 'close', id })); }
    });
  }
  close() { clearInterval(this.sweep); for (const ws of this.server.clients) ws.terminate(); this.server.close(); }
}
