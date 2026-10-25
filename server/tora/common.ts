import type {} from './bindings.ts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { AccountError } from '../src/account.ts';
import { handleAccountError } from '../src/accountHttp.ts';
import { OAuthProviderError } from '../src/oauth/types.ts';
import type { AppEnv } from '../src/types.ts';
export const API_ORIGIN='https://launcher-api.cogniticteam.com';
export const AI_ORIGIN='https://launcher-ai.cogniticteam.com';
export const SIGNAL_ORIGIN='https://launcher-signal.cogniticteam.com';
export function baseApp(surface:string) {
  const app=new Hono<AppEnv>();
  app.use('*',cors({origin:(origin)=>['https://154.8.230.216',API_ORIGIN,AI_ORIGIN,SIGNAL_ORIGIN,'http://xmcl.runtime','http://localhost:3000'].includes(origin)?origin:undefined,allowHeaders:['Authorization','DPoP','Content-Type','Idempotency-Key'],exposeHeaders:['Date','X-Request-ID'],allowMethods:['GET','HEAD','POST','DELETE','OPTIONS']}));
  app.use('*',bodyLimit({maxSize:1024*1024}));
  app.use('*',async(c,next)=>{
    c.env.XMCL_SESSION_SECRET=c.env.TORA_SESSION_SECRET;
    c.env.XMCL_MULTIPLAYER_TICKET_SECRET=c.env.TORA_MULTIPLAYER_TICKET_SECRET;
    c.set('waitUntil',(promise)=>c.executionCtx.waitUntil(promise));
    c.header('Date',new Date().toUTCString());c.header('X-Content-Type-Options','nosniff');
    c.header('X-Request-ID',crypto.randomUUID());
    const ip=c.req.header('CF-Connecting-IP') || 'local';
    if(c.env.RATE_LIMITER&&!(await c.env.RATE_LIMITER.limit({key:ip})).success)return c.json({error:'rate_limit_exceeded'},429,{'Retry-After':'60'});
    await next();
  });
  app.get('/health',c=>c.json({service:`tora-launcher-${surface}`,status:c.env.TORA_SESSION_SECRET?'ok':'awaiting-secrets',version:'0.1.0',storage:'cloudflare-durable-objects',deviceSessions:true,aiProvider:surface==='ai'?'DeepSeek':undefined,aiConfigured:surface==='ai'?!!c.env.TORA_DEEPSEEK_API_KEY:undefined,cloudStorage:false,paidHosting:false,relay:false}));
  app.get('/',c=>c.json({name:'TORA Launcher',service:surface,health:'/health'}));
  app.onError((error,c)=>{
    if(error instanceof AccountError||error instanceof OAuthProviderError)return handleAccountError(error,c);
    if(error instanceof HTTPException)return error.getResponse();
    console.error({event:'tora.request.failed',method:c.req.method,path:c.req.path,errorName:error.name,location:error.stack?.split('\n').slice(1,3).map(line=>line.replace(/https?:\/\/[^ )]+/g,'[url]'))});return c.json({error:'service_error',message:'服务暂时无法完成此请求'},500)
  });
  return app;
}
