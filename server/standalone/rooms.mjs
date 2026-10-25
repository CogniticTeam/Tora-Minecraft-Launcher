import { MultiplayerRoomObject } from '../apps/signaling/room.ts';

class PeerSocket {
  constructor(){this.attachment=null;this.pending=[];this.ws=null;this.closed=false;}
  get readyState(){return this.closed?3:this.ws?.readyState??1;}
  accept(){}
  addEventListener(){}
  send(message){if(this.closed)return;if(this.ws)this.ws.send(message);else this.pending.push(message);}
  close(code=1000,reason=''){this.closed=true;if(this.ws&&this.ws.readyState<2)this.ws.close(code,reason);}
  serializeAttachment(value){this.attachment=structuredClone(value);}
  deserializeAttachment(){return structuredClone(this.attachment);}
  attach(ws){this.ws=ws;if(this.closed){ws.close();return}for(const item of this.pending)ws.send(item);this.pending=[];}
}

/** Reuses the production room protocol; only adapts socket and persistence APIs. */
export class RoomNamespace {
  constructor(database,secret){this.database=database;this.secret=secret;this.rooms=new Map();}
  idFromName(name){return String(name);}
  get(name){
    name=String(name);let record=this.rooms.get(name);if(record)return record;
    let timer;const sockets=new Map();let room;let tail=Promise.resolve();
    const serialize=operation=>{const result=tail.then(operation);tail=result.catch(()=>{});return result;};
    const schedule=at=>{clearTimeout(timer);timer=setTimeout(()=>{void serialize(()=>room.alarm()).catch(()=>{})},Math.max(100,Math.min(at-Date.now(),2147483647)));timer.unref();};
    const state={id:{toString:()=>name},storage:this.database.storage('room:'+name,schedule),
      acceptWebSocket(socket,tags=[]){sockets.set(socket,tags)},getWebSockets(tag){return [...sockets].filter(([s,t])=>s.readyState===1&&(!tag||t.includes(tag))).map(([s])=>s)},waitUntil(p){void p.catch(()=>{})}};
    const platform={pair:()=>{const server=new PeerSocket();return {0:server,1:server}},response:client=>{
      // Node's standard Response disallows 101; the HTTP adapter consumes this marker without sending it as a normal response.
      const response=new Response(null);Object.defineProperty(response,'status',{value:101});response.webSocket=client;return response;
    }};
    room=new MultiplayerRoomObject(state,{XMCL_MULTIPLAYER_TICKET_SECRET:this.secret},platform);
    record={fetch:request=>serialize(()=>room.fetch(request)),
      attach(peer,ws){peer.attach(ws);ws.on('message',(data,binary)=>{void serialize(()=>room.webSocketMessage(peer,binary?data.buffer:data.toString())).catch(()=>peer.close(1011,'Room error'))});ws.on('close',(code,reason)=>{void serialize(()=>room.webSocketClose(peer,code,reason.toString(),code===1000)).finally(()=>sockets.delete(peer)).catch(()=>{})});ws.on('error',()=>room.webSocketError(peer));},
      shutdown(){clearTimeout(timer);for(const socket of sockets.keys())socket.close(1012,'Service restart')}};
    this.rooms.set(name,record);const saved=this.database.db.prepare('SELECT at FROM alarms WHERE namespace=?').get('room:'+name);if(saved)schedule(saved.at);return record;
  }
  restoreAlarms(){for(const row of this.database.db.prepare('SELECT namespace,value FROM kv WHERE namespace LIKE \'room:%\' AND key=\'room\'').all()){const state=JSON.parse(row.value);if(state.status!=='closed'){for(const member of Object.values(state.members||{})){member.disconnectedAt??=Date.now();member.status='negotiating'}state.status='waiting-master';state.revision++;this.database.db.prepare('UPDATE kv SET value=? WHERE namespace=? AND key=\'room\'').run(JSON.stringify(state),row.namespace);const times=[state.expiresAt,...Object.values(state.members||{}).map(m=>m.disconnectedAt+30000)];this.database.db.prepare('INSERT INTO alarms(namespace,at) VALUES(?,?) ON CONFLICT(namespace) DO UPDATE SET at=excluded.at').run(row.namespace,Math.min(...times))}this.get(row.namespace.slice(5));}}
  shutdown(){for(const room of this.rooms.values())room.shutdown();}
}
