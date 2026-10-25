import { forwardToSelfHost } from './selfhostProxy.ts';
import { baseApp, API_ORIGIN, AI_ORIGIN, SIGNAL_ORIGIN } from './common.ts';
import zulu from '../../xmcl/xmcl-runtime/java/zulu.json';
import elyby from '../../xmcl/xmcl-runtime/elyby/cache.json';
export { ToraAccountObject } from './accounts.ts';
export { DpopReplayObject } from '../src/cloudflare/dpopReplay.ts';
const app=baseApp('api');
app.use('/v1/auth/device',async(c,next)=>{const limiter=c.env.REGISTRATION_LIMITER as any;if(limiter&&!(await limiter.limit({key:c.req.header('CF-Connecting-IP')||'local'})).success)return c.json({error:'registration_rate_limit'},429);await next()});
app.all('/v1/auth/*',c=>c.env.ACCOUNTS.get(c.env.ACCOUNTS.idFromName('accounts-v1')).fetch(c.req.raw));
app.all('/v1/account',c=>c.env.ACCOUNTS.get(c.env.ACCOUNTS.idFromName('accounts-v1')).fetch(c.req.raw));
app.all('/v1/account/*',c=>c.env.ACCOUNTS.get(c.env.ACCOUNTS.idFromName('accounts-v1')).fetch(c.req.raw));
app.all('/v1/sessions/*',c=>c.env.ACCOUNTS.get(c.env.ACCOUNTS.idFromName('accounts-v1')).fetch(c.req.raw));
app.get('/flights',c=>c.json({xmclApiBaseUrl:API_ORIGIN,xmclBillingApiBaseUrl:API_ORIGIN,builtinAgent:false}));
app.get('/config',c=>c.json({common:API_ORIGIN,ai:AI_ORIGIN,signaling:SIGNAL_ORIGIN}));
app.get('/zulu',c=>c.json(zulu,200,{'Cache-Control':'public, max-age=3600'}));
app.get('/elyby/authlib',c=>c.json(elyby,200,{'Cache-Control':'public, max-age=3600'}));
app.get('/notifications',c=>c.json([]));
app.get('/latest',c=>c.json({name:'0.72.0',body:'TORA 自有服务版；更新公告由 TORA 发布。',date:'2026-10-23',files:[],newUpdate:false,operation:'manual',url:API_ORIGIN+'/downloads'}));
app.get('/news',async c=>{
  const cached=await c.env.CACHE?.get('minecraft-news','json');if(cached)return c.json(cached);
  const response=await fetch('https://launchercontent.mojang.com/v2/news.json',{signal:AbortSignal.timeout(12000)});
  if(!response.ok)return c.json({error:'minecraft_news_unavailable'},502);
  const body=await response.json() as any;
  const news=(body.entries||[]).filter((e:any)=>e.newsPageImage?.url).slice(0,12).map((e:any)=>({category:e.tag||e.category||'Minecraft',title:e.title,date:e.date,description:e.text||'',link:e.readMoreLink,image:{url:new URL(e.newsPageImage.url,'https://launchercontent.mojang.com').href,...(e.newsPageImage.dimensions||{width:772,height:350})}}));
  if(c.env.CACHE)c.executionCtx.waitUntil(c.env.CACHE.put('minecraft-news',JSON.stringify(news),{expirationTtl:1800}));
  return c.json(news);
});
app.get('/contributors',c=>c.json([]));
app.get('/support',c=>c.html('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TORA 支持</title><style>body{max-width:640px;margin:60px auto;padding:20px;font:16px/1.7 system-ui;background:#141414;color:#eee}input,textarea,button{display:block;box-sizing:border-box;width:100%;margin:12px 0 24px;padding:12px;background:#222;color:#fff;border:1px solid #555;border-radius:8px;font:inherit}button{background:#eee;color:#111;cursor:pointer}</style><h1>TORA 支持</h1><p>反馈提交到 TORA 自有服务，保留 30 天。请不要包含密码、API 密钥或访问令牌。</p><form method="post"><label>问题描述<textarea name="message" required minlength="10" maxlength="8000" rows="8"></textarea></label><label>联系方式（可选）<input name="contact" maxlength="256"></label><button>提交反馈</button></form></html>'));
app.post('/support',async c=>{
  const origin=c.req.header('Origin');if(origin!==API_ORIGIN&&origin!==c.env.TORA_PUBLIC_ORIGIN)return c.json({error:'invalid_origin'},403);
  const limiter=c.env.REGISTRATION_LIMITER as any;if(limiter&&!(await limiter.limit({key:`feedback:${c.req.header('CF-Connecting-IP')||'local'}`})).success)return c.json({error:'rate_limit_exceeded'},429);
  const body=await c.req.parseBody();const message=String(body.message||'').trim(),contact=String(body.contact||'').trim();
  if(message.length<10||message.length>8000||contact.length>256)return c.json({error:'invalid_feedback'},400);
  const id=crypto.randomUUID();await c.env.CACHE.put(`feedback:${id}`,JSON.stringify({id,message,contact,createdAt:new Date().toISOString()}),{expirationTtl:30*86400});
  return c.html(`<!doctype html><meta charset="utf-8"><title>TORA 反馈已提交</title><h1>反馈已提交</h1><p>编号：${id}</p><a href="/support">返回</a>`);
});
app.get('/modrinth/auth',async c=>{
  const clientId=c.env.TORA_MODRINTH_CLIENT_ID as string|undefined;
  const secret=c.env.TORA_MODRINTH_CLIENT_SECRET as string|undefined;
  if(!clientId||!secret)return c.json({error:'tora_modrinth_oauth_not_configured'},503);
  const code=c.req.query('code')||'',redirect=c.req.query('redirect_uri')||'';
  let url:URL;try{url=new URL(redirect)}catch{return c.json({error:'invalid_redirect_uri'},400)}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/modrinth-auth'||url.username||url.password||url.search||url.hash||!url.port||code.length>4096||!code)return c.json({error:'invalid_oauth_request'},400);
  const response=await fetch('https://api.modrinth.com/_internal/oauth/token',{method:'POST',headers:{Authorization:secret,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,redirect_uri:redirect,code,grant_type:'authorization_code'}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();return c.json({error:'modrinth_token_exchange_failed'},502)}
  return new Response(response.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
});
app.get('/downloads',c=>c.html('<!doctype html><meta charset="utf-8"><title>TORA 下载</title><h1>TORA Launcher</h1><p>当前版本通过本地构建分发。公开安装包尚未上传。</p>'));
app.get('/peer',c=>c.html('<!doctype html><meta charset="utf-8"><title>TORA 联机</title><h1>TORA 联机邀请</h1><p>请在 TORA 启动器中输入房间名称加入。</p>'));
app.get('/guide/*',c=>c.redirect(API_ORIGIN+'/support'));
export default { fetch(request:Request,env:any,ctx:any) { return env.TORA_SELFHOST_ORIGIN ? forwardToSelfHost(request,env) : app.fetch(request,env,ctx); } };
