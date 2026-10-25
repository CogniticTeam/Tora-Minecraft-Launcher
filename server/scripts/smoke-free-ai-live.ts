import assert from 'node:assert/strict';
import {generateXmclDpopKey,createXmclDpopProof} from '../../xmcl/xmcl-runtime/xmclAccount/XmclAccountDpop.ts';
const api='https://launcher-api.cogniticteam.com', ai='https://launcher-ai.cogniticteam.com';
const key=generateXmclDpopKey(); // Fresh installation, held in memory only; never allowlisted.
const clock=await fetch(api,{method:'HEAD'});const skew=Date.parse(clock.headers.get('date')!)-Date.now();
async function request(base:string,path:string,method:string,body?:unknown,token?:string){
 const url=base+path;
 return fetch(url,{method,headers:{'Content-Type':'application/json',DPoP:createXmclDpopProof(key,method,url,token,Date.now()+skew),...(token?{Authorization:`DPoP ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
}
const registered=await request(api,'/v1/auth/device','POST',{dpopJwk:key.publicJwk});assert.equal(registered.status,200);
const {session}=await registered.json() as any;
const access=await request(ai,'/v1/access','GET',undefined,session.accessToken);assert.equal(access.status,200);const permissions=await access.json() as any;assert.equal(permissions.free,true);assert.equal(permissions.allowed,true);
const reply=await request(ai,'/v1/chat/completions','POST',{xmcl:{promptVersion:1,agentType:'compaction',locale:'zh-CN'},messages:[{role:'user',content:'Reply only TORA_FREE_OK.'}],max_tokens:256,stream:true},session.accessToken);
assert.equal(reply.status,200);const stream=await reply.text();assert.ok(stream.includes('[DONE]'));const output=stream.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)).choices?.[0]?.delta?.content||'').join('');assert.ok(output.length>0);
console.log(JSON.stringify({freshDevice:true,allowlistRequired:false,freeAccess:permissions.free,status:reply.status,streamCompleted:true,replyReceived:true}));
