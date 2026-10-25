import { forwardToSelfHost } from './selfhostProxy.ts';
import { baseApp } from './common.ts';
import { createMultiplayerRoutes } from '../src/routes/multiplayer.ts';
import { matchMultiplayerUpgrade } from '../src/realtime.ts';
import { xmclAuth } from '../src/middleware/xmclAuth.ts';
import { MultiplayerRoomObject as UpstreamRoom } from '../apps/signaling/room.ts';
export class MultiplayerRoomObject extends UpstreamRoom {
  constructor(state:any,env:any){super(state,{...env,XMCL_MULTIPLAYER_TICKET_SECRET:env.TORA_MULTIPLAYER_TICKET_SECRET})}
}
const app=baseApp('signaling');
app.route('/',createMultiplayerRoutes(undefined,{
  resolveAdmissionTelemetry:async c=>({record:async(event:any)=>{await c.env.CACHE.put(`admission:${event.admissionId}`,JSON.stringify(event),{expirationTtl:86400})}} as any),
  resolveAttemptTelemetry:async c=>({record:async(event:any)=>{const key=`attempt:${event.accountId}:${event.attemptId}`;if(await c.env.CACHE.get(key))return 'duplicate';await c.env.CACHE.put(key,JSON.stringify(event),{expirationTtl:86400});return 'inserted'}} as any),
}));
app.post('/v1/rtc/official',xmclAuth(['account:read']),async c=>{
  const stuns=['stun.cloudflare.com:3478'];
  return c.json({stuns,uris:[],servers:[],relayAvailable:false});
});
export default {
  fetch(request:Request,env:any,ctx:any){
    if(env.TORA_SELFHOST_ORIGIN)return forwardToSelfHost(request,env);
    const room=matchMultiplayerUpgrade(request);
    if(room!==undefined){
      const url=new URL(request.url);url.pathname='/connect';
      return env.MULTIPLAYER_ROOMS.get(env.MULTIPLAYER_ROOMS.idFromName(room)).fetch(new Request(url,request));
    }
    return app.fetch(request,env,ctx);
  },
};
