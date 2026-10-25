import{writeFileSync}from'node:fs';
import assert from'node:assert/strict';import{once}from'node:events';import{WebSocket}from'ws';import{generateXmclDpopKey,createXmclDpopProof}from'../../xmcl/xmcl-runtime/xmclAccount/XmclAccountDpop.ts';
const origin=process.argv[2]||'http://127.0.0.1:8771';
const started=Date.now();
const receipt=process.argv[3];
async function signed(key,path,body,token,method='POST'){
 const url=origin+path;const r=await fetch(url,{method,headers:{'Content-Type':'application/json',DPoP:createXmclDpopProof(key,method,url,token),...(token?{Authorization:'DPoP '+token}:{})},...(method==='GET'?{}:{body:JSON.stringify(body||{})}),signal:AbortSignal.timeout(10000)});
 const data=await r.json();if(!r.ok)throw new Error(`probe_http_${r.status}_${data.error||'failed'}`);return data;
}
const health=await(await fetch(origin+'/health')).json();assert.equal(health.storage,'sqlite');
const one=generateXmclDpopKey(),two=generateXmclDpopKey();const a=await signed(one,'/v1/auth/device',{dpopJwk:one.publicJwk});const b=await signed(two,'/v1/auth/device',{dpopJwk:two.publicJwk});
await signed(one,'/v1/account',undefined,a.session.accessToken,'GET');
const ticket=await signed(one,'/v1/account/community-ticket',{},a.session.accessToken);assert.ok(ticket.accessToken);assert.equal(ticket.subject,a.account.accountId);
const created=await signed(one,'/v1/multiplayer/rooms',{displayName:'StagingOwner',maxPeers:4},a.session.accessToken);
const wsOrigin=origin.replace(/^http/,'ws');
const owner=new WebSocket(wsOrigin+created.socketUrl+'?ticket='+encodeURIComponent(created.ticket));owner.on('error',()=>{});await once(owner,'open');
const joined=await signed(two,'/v1/multiplayer/rooms/'+created.roomId+'/join',{displayName:'StagingMember',createIfMissing:false,maxPeers:4},b.session.accessToken);
const member=new WebSocket(wsOrigin+joined.socketUrl+'?ticket='+encodeURIComponent(joined.ticket));member.on('error',()=>{});await once(member,'open');
const gotSignal=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('signal_timeout')),5000);owner.on('message',buffer=>{const msg=JSON.parse(buffer.toString());if(msg.type==='signal'&&msg.payload?.probe==='dedicated-server-test'){clearTimeout(timer);resolve(msg)}})});
member.send(JSON.stringify({type:'signal',payload:{probe:'dedicated-server-test'}}));await gotSignal;
owner.close();member.close();if(receipt)writeFileSync(receipt,JSON.stringify({createdAt:started,accounts:[a.account.accountId,b.account.accountId],room:created.roomId}),{mode:0o600});console.log(JSON.stringify({status:'passed',accountRegistration:2,authenticatedAccountRead:true,scopedCommunityTicket:true,webSocketPeers:2,signalForwarded:true,totalMs:Date.now()-started}));
