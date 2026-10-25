import test from 'node:test';
import assert from 'node:assert/strict';
import { ToraAccountObject } from './accounts.ts';
import { DpopReplayObject } from '../src/cloudflare/dpopReplay.ts';
import { generateXmclDpopKey,createXmclDpopProof } from '../../xmcl/xmcl-runtime/xmclAccount/XmclAccountDpop.ts';

class TestStorage {
  data=new Map<string,any>();
  async get<T>(key:string):Promise<T|undefined>{return structuredClone(this.data.get(key))}
  async put(key:string,value:unknown){this.data.set(key,structuredClone(value))}
  async delete(key:string){return this.data.delete(key)}
  async setAlarm(){} async deleteAlarm(){} async deleteAll(){this.data.clear()}
}
function harness(){
  const storage=new TestStorage(),shards=new Map<string,DpopReplayObject>();
  const env={TORA_SESSION_SECRET:'unit-test-secret-not-used-in-any-deployment-0123456789',DPOP_REPLAY:{idFromName:(name:string)=>name,get:(name:string)=>{if(!shards.has(name))shards.set(name,new DpopReplayObject({storage:new TestStorage()} as any));return shards.get(name)!}}};
  return {storage,env,object:new ToraAccountObject({storage},env)};
}
const base='https://launcher-api.cogniticteam.com';
function request(key:ReturnType<typeof generateXmclDpopKey>,path:string,method='POST',body:unknown={dpopJwk:key.publicJwk},accessToken?:string){
  const url=base+path;
  return new Request(url,{method,headers:{'content-type':'application/json',DPoP:createXmclDpopProof(key,method,url,accessToken),...(accessToken?{Authorization:`DPoP ${accessToken}`}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
}
test('device registration requires possession of a public key and rejects private keys',async()=>{
  const h=harness(),key=generateXmclDpopKey();
  const noProof=await h.object.fetch(new Request(base+'/v1/auth/device',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dpopJwk:key.publicJwk})}));
  assert.equal(noProof.status,401);
  const privateKey=await h.object.fetch(request(key,'/v1/auth/device','POST',{dpopJwk:key.privateJwk}));
  assert.equal(privateKey.status,422);assert.equal(h.storage.data.size,0);
});
test('persistent account survives object reconstruction and sessions contain no signing secret',async()=>{
  const h=harness(),key=generateXmclDpopKey();
  const first=await h.object.fetch(request(key,'/v1/auth/device'));assert.equal(first.status,200);
  const body=await first.json() as any;assert.equal(body.session.tokenType,'DPoP');assert.ok(body.account.accountId.startsWith('device_'));
  assert.ok(!JSON.stringify(body).includes(h.env.TORA_SESSION_SECRET));
  const restored=new ToraAccountObject({storage:h.storage},h.env);
  const second=await restored.fetch(request(key,'/v1/auth/device'));const value=await second.json() as any;
  assert.equal(value.account.accountId,body.account.accountId);assert.equal(value.account.createdAt,body.account.createdAt);
  const read=await restored.fetch(request(key,'/v1/account','GET',undefined,value.session.accessToken));assert.equal(read.status,200);
  assert.equal((await read.json() as any).accountId,value.account.accountId);
});
test('replayed device proofs and proofs for a different origin are rejected',async()=>{
  const h=harness(),key=generateXmclDpopKey();const req=request(key,'/v1/auth/device');
  const copy=req.clone();assert.equal((await h.object.fetch(req)).status,200);assert.equal((await h.object.fetch(copy)).status,401);
  const wrong=request(key,'/v1/auth/device');wrong.headers.set('DPoP',createXmclDpopProof(key,'POST','https://attacker.test/v1/auth/device'));
  assert.equal((await h.object.fetch(wrong)).status,401);
});
test('serialized concurrent device creation preserves one account with separate sessions',async()=>{
  const h=harness(),key=generateXmclDpopKey();
  const responses=await Promise.all([h.object.fetch(request(key,'/v1/auth/device')),h.object.fetch(request(key,'/v1/auth/device'))]);
  const bodies=await Promise.all(responses.map(r=>r.json())) as any[];
  assert.equal(bodies[0].account.accountId,bodies[1].account.accountId);assert.notEqual(bodies[0].session.sessionId,bodies[1].session.sessionId);
  assert.equal([...h.storage.data.keys()].filter(k=>k.startsWith('account:')).length,1);
});
test('a second device cannot read a session bound to the first key',async()=>{
  const h=harness(),owner=generateXmclDpopKey(),other=generateXmclDpopKey();
  const result=await (await h.object.fetch(request(owner,'/v1/auth/device'))).json() as any;
  const response=await h.object.fetch(request(other,'/v1/account','GET',undefined,result.session.accessToken));assert.equal(response.status,401);
});
test('refresh rotation persists and reuse revokes the refresh family',async()=>{
  const h=harness(),key=generateXmclDpopKey();const registered=await (await h.object.fetch(request(key,'/v1/auth/device'))).json() as any;
  const refresh=()=>{const req=request(key,'/v1/sessions/refresh','POST',{sessionId:registered.session.sessionId,refreshToken:registered.session.refreshToken});req.headers.set('Authorization',`DPoP ${registered.session.accessToken}`);return h.object.fetch(req)};
  const first=await refresh();assert.equal(first.status,200);const next=await first.json() as any;assert.notEqual(next.session.refreshToken,registered.session.refreshToken);
  assert.equal((await refresh()).status,401);
});

test('community ticket issuance requires active session possession and has a separate audience', async () => {
  const h=harness(), key=generateXmclDpopKey(), other=generateXmclDpopKey();
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const env={...h.env,TORA_COMMUNITY_SIGNING_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',keys.privateKey))};
  const object=new ToraAccountObject({storage:h.storage},env);
  const registered=await (await object.fetch(request(key,'/v1/auth/device'))).json() as any;
  assert.equal((await object.fetch(new Request(base+'/v1/account/community-ticket',{method:'POST'}))).status,401);
  assert.equal((await object.fetch(request(other,'/v1/account/community-ticket','POST',{},registered.session.accessToken))).status,401);
  const result=await object.fetch(request(key,'/v1/account/community-ticket','POST',{},registered.session.accessToken));
  assert.equal(result.status,200);
  const ticket=await result.json() as any;
  assert.equal(ticket.subject,registered.account.accountId);
  const claims=JSON.parse(Buffer.from(ticket.accessToken.split('.')[1],'base64url').toString());
  assert.equal(claims.aud,'tora-community');
  assert.equal(claims.exp-claims.iat,300);
  for(const [key,value] of h.storage.data){if(key.startsWith('session:'))await h.storage.put(key,{...value,revokedAt:new Date().toISOString()});}
  assert.equal((await object.fetch(request(key,'/v1/account/community-ticket','POST',{},registered.session.accessToken))).status,401);
});
