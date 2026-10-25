import signaling from '../tora/signaling.ts';
import {MultiplayerRoomObject as Room}from'../tora/signaling.ts';
import{timingSafeEqual}from'node:crypto';
const bytes=new TextEncoder();
function authorized(request:Request,env:any){const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';const expected=env.TORA_MIGRATION_TOKEN||'';return Date.now()<Number(env.TORA_MIGRATION_DEADLINE)&&expected.length>=40&&token.length===expected.length&&timingSafeEqual(bytes.encode(token),bytes.encode(expected));}
export class MultiplayerRoomObject extends Room {
  constructor(private migrationState:any,private migrationEnv:any){super(migrationState,migrationEnv)}
  override async fetch(request:Request){
    if(new URL(request.url).pathname==='/_tora_migration/room'){
      if(!authorized(request,this.migrationEnv))return new Response(null,{status:404});
      for(const socket of this.migrationState.getWebSockets()){await super.webSocketClose(socket,1012,'Server migration',false)}
      return Response.json({entries:[...await this.migrationState.storage.list()],alarmAt:await this.migrationState.storage.getAlarm()},{headers:{'Cache-Control':'no-store'}});
    }
    if(this.migrationEnv.TORA_MIGRATION_FREEZE==='1')return new Response('Migration in progress',{status:503});
    return super.fetch(request);
  }
}
export default {fetch(request:Request,env:any,ctx:any){const url=new URL(request.url);if(url.pathname==='/_tora_migration/environment'){if(!authorized(request,env))return new Response(null,{status:404});return Response.json({environment:{TORA_MULTIPLAYER_TICKET_SECRET:env.TORA_MULTIPLAYER_TICKET_SECRET,TORA_SESSION_SECRET:env.TORA_SESSION_SECRET}},{headers:{'Cache-Control':'no-store'}})}if(url.pathname==='/_tora_migration/room'){
 if(!authorized(request,env))return new Response(null,{status:404});const room=url.searchParams.get('name')||'',id=url.searchParams.get('id')||'';if(id&&!/^[a-f0-9]{64}$/i.test(id)||!id&&!/^[a-zA-Z0-9_-]{1,64}$/.test(room))return new Response(null,{status:400});return env.MULTIPLAYER_ROOMS.get(id?env.MULTIPLAYER_ROOMS.idFromString(id):env.MULTIPLAYER_ROOMS.idFromName(room)).fetch(request);
 }if(env.TORA_MIGRATION_FREEZE==='1')return new Response('Migration in progress',{status:503,headers:{'Retry-After':'30'}});return signaling.fetch(request,env,ctx)}};
