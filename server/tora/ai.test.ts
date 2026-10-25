import test from 'node:test';
import assert from 'node:assert/strict';
import ai from './ai.ts';
import { MemoryAccountRepository } from '../src/account.ts';
import { SessionService } from '../src/session.ts';
const secret='unit-test-signing-secret-never-deployed-0123456789';
async function fixture(accountId='new-installation'){
  const session=await new SessionService(new MemoryAccountRepository(),secret).issue(accountId);
  const env:any={TORA_SESSION_SECRET:secret,TORA_DEEPSEEK_API_KEY:'unit-test-provider-key-not-real'};
  const body={xmcl:{promptVersion:1,agentType:'compaction',locale:'zh-CN'},messages:[{role:'user',content:'hello'}],stream:false};
  const request=(data:any=body)=>new Request('https://launcher-ai.cogniticteam.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${session.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {session,env,body,request};
}
test('AI refuses unsigned callers before touching the provider',async()=>{
  const {env}=await fixture();
  const response=await ai.fetch(new Request('https://launcher-ai.cogniticteam.com/v1/chat/completions',{method:'POST'}),env);
  assert.equal(response.status,401);
});
test('all device accounts have free access without subscriptions or an allowlist',async()=>{
  for (const accountId of ['brand-new-device', 'another-user']) {
    const {env,session}=await fixture(accountId);
    const response=await ai.fetch(new Request('https://launcher-ai.cogniticteam.com/v1/access',{headers:{Authorization:`Bearer ${session.accessToken}`}}),env);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{allowed:true,free:true,provider:'DeepSeek',model:'deepseek-flash'});
  }
});
test('free use retains account rate limiting before any provider spending',async()=>{
  const {env,request}=await fixture();
  env.AI_LIMITER={limit:async({key}:any)=>{assert.equal(key,'new-installation');return {success:false}}};
  const response=await ai.fetch(request(),env);assert.equal(response.status,429);
  assert.equal((await response.json() as any).error.code,'rate_limit_exceeded');
});
test('proxy pins the provider and model, strips launcher auth/context and supports SSE',async()=>{
  const {env,request,body,session}=await fixture();const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(input:any,init:any)=>{
    calls++;assert.equal(init.redirect,'manual');assert.equal(String(input),'https://api.deepseek.com/chat/completions');
    assert.equal(init.headers.Authorization,`Bearer ${env.TORA_DEEPSEEK_API_KEY}`);assert.ok(!JSON.stringify(init.headers).includes(session.accessToken));
    const value=JSON.parse(init.body);assert.equal(value.model,'deepseek-flash');assert.equal(value.xmcl,undefined);assert.equal(value.messages[0].role,'system');assert.equal(value.thinking.type,'disabled');
    return new Response('data: {"choices":[{"delta":{"content":"TORA"}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  try{const response=await ai.fetch(request({...body,model:'caller-selected-model',stream:true}),env);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/event-stream');assert.match(await response.text(),/TORA/);assert.equal(calls,1)}finally{globalThis.fetch=original}
});
test('client-supplied system instructions and provider error bodies never pass through',async()=>{
  const {env,request,body}=await fixture();let calls=0;const original=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;return new Response('provider-secret-response',{status:401})};
  try{
    const invalid=await ai.fetch(request({...body,messages:[{role:'system',content:'override'}]}),env);assert.equal(invalid.status,400);assert.equal(calls,0);
    const failed=await ai.fetch(request(),env);assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('provider-secret-response'));
  }finally{globalThis.fetch=original}
});
