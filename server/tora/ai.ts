import { baseApp } from './common.ts';
import { xmclAuth } from '../src/middleware/xmclAuth.ts';
import { parseLauncherAgentRequestContext,buildLauncherAgentSystemPrompt } from '../src/launcherAgentPrompt.ts';
const app=baseApp('ai');
app.get('/v1/access',xmclAuth(['ai:invoke']),c=>c.json({allowed:true,free:true,provider:'DeepSeek',model:'deepseek-flash'}));
app.post('/v1/chat/completions',xmclAuth(['ai:invoke']),async c=>{
  const principal=c.get('xmclPrincipal')!;
  if(!c.env.TORA_DEEPSEEK_API_KEY)return c.json({error:{message:'DeepSeek 服务尚未配置',code:'provider_not_configured'}},503);
  if(c.env.AI_LIMITER&&!(await c.env.AI_LIMITER.limit({key:principal.accountId})).success)return c.json({error:{message:'请求过于频繁，请稍后重试',code:'rate_limit_exceeded'}},429);
  const body=await c.req.json();
  const context=parseLauncherAgentRequestContext(body.xmcl);
  if(!context||!Array.isArray(body.messages)||body.messages.length>100||body.messages.some((m:any)=>!['user','assistant','tool'].includes(m.role)))return c.json({error:{message:'Invalid launcher agent context or messages',code:'invalid_request'}},400);
  const tools=Array.isArray(body.tools)?body.tools:undefined;
  const messages=[{role:'system',content:buildLauncherAgentSystemPrompt(context,(tools||[]).map((tool:any)=>tool.function?.name).filter(Boolean))},...body.messages];
  console.log({event:'tora.ai.provider.dispatch'});
  const response=await fetch('https://api.deepseek.com/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${c.env.TORA_DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:'disabled'},max_tokens:Math.min(Math.max(Number(body.max_tokens)||4096,1),8192),...(tools?{tools}:{}),stream:body.stream===true}),
    signal:AbortSignal.timeout(120000),redirect:'manual',
  });
  console.log({event:'tora.ai.provider.response',status:response.status});
  if(response.status>=300&&response.status<400){await response.body?.cancel();return c.json({error:{message:'DeepSeek 返回了不允许跟随的重定向',code:'provider_redirect_rejected'}},502)}
  if(!response.ok){await response.body?.cancel();return c.json({error:{message:`DeepSeek 请求失败（HTTP ${response.status}）`,code:'upstream_error'}},502)}
  return new Response(response.body,{headers:{'Content-Type':body.stream===true?'text/event-stream':'application/json','Cache-Control':'no-store'}});
});
export default app;
