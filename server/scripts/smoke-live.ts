import {generateXmclDpopKey,createXmclDpopProof} from '../../xmcl/xmcl-runtime/xmclAccount/XmclAccountDpop.ts';
const api='https://launcher-api.cogniticteam.com',signal='https://launcher-signal.cogniticteam.com';
const serverTime=await fetch(api,{method:'HEAD'});const skew=Date.parse(serverTime.headers.get('date')!)-Date.now();
async function call(key:any,base:string,path:string,body?:unknown,session?:any,method='POST'){
 const url=base+path;const headers:any={'Content-Type':'application/json',DPoP:createXmclDpopProof(key,method,url,session?.accessToken,Date.now()+skew)};
 if(session)headers.Authorization=`DPoP ${session.accessToken}`;
 const r=await fetch(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const text=await r.text();let data:any;try{data=JSON.parse(text)}catch{data={}}
 if(!r.ok)throw new Error(`HTTP ${r.status} ${path}: ${data.error||data.message||'request failed'}`);
 return data;
}
const hostKey=generateXmclDpopKey(),memberKey=generateXmclDpopKey();
const host=await call(hostKey,api,'/v1/auth/device',{dpopJwk:hostKey.publicJwk});
const member=await call(memberKey,api,'/v1/auth/device',{dpopJwk:memberKey.publicJwk});
console.log(JSON.stringify({deviceRegistration:'passed',sessionsBound:host.session.tokenType==='DPoP'&&member.session.tokenType==='DPoP'}));
const profile=await call(hostKey,api,'/v1/account',undefined,host.session,'GET');
console.log(JSON.stringify({accountRead:profile.accountId===host.account.accountId}));
const room=await call(hostKey,signal,'/v1/multiplayer/rooms',{displayName:'TORA deployment probe',maxPeers:2},host.session);
let hostSocket:WebSocket|undefined,memberSocket:WebSocket|undefined;
async function connect(ticket:any){const url=new URL(ticket.socketUrl,signal);url.protocol='wss:';url.searchParams.set('ticket',ticket.ticket);const ws=new WebSocket(url);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket timeout')),15000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('WebSocket upgrade failed'))},{once:true})});return ws}
try{
 hostSocket=await connect(room);
 const admission=await call(memberKey,signal,`/v1/multiplayer/rooms/${room.roomId}/join`,{displayName:'TORA peer probe',createIfMissing:false},member.session);
 memberSocket=await connect(admission);
 console.log(JSON.stringify({roomCreated:true,hostWebSocketOpen:hostSocket.readyState===1,memberWebSocketOpen:memberSocket.readyState===1,roles:[room.role,admission.role]}));
 const relay=await call(hostKey,signal,'/v1/rtc/official',{},host.session);
 console.log(JSON.stringify({iceConfig:'passed',stuns:relay.stuns,relayAvailable:relay.relayAvailable}));
}finally{
 hostSocket?.close();memberSocket?.close();
 await call(hostKey,signal,`/v1/multiplayer/rooms/${room.roomId}`,undefined,host.session,'DELETE');
 console.log(JSON.stringify({temporaryRoomClosed:true}));
}
