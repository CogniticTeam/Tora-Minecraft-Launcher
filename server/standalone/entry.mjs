import {createServer}from'node:http';
import {Readable}from'node:stream';
import {createReadStream,readFileSync,statSync}from'node:fs';
import {fileURLToPath}from'node:url';
import {timingSafeEqual}from'node:crypto';
import {WebSocketServer}from'ws';
import api from '../tora/api.ts';
import {ToraAccountObject,DurableAccountRepository,accountRuntime}from'../tora/accounts.ts';
import {DpopReplayObject}from'../src/cloudflare/dpopReplay.ts';
import {baseApp}from'../tora/common.ts';
import {createMultiplayerRoutes}from'../src/routes/multiplayer.ts';
import {xmclAuth}from'../src/middleware/xmclAuth.ts';
import {matchMultiplayerUpgrade}from'../src/realtime.ts';
import {communityGateway}from'../tora/communityGateway.ts';
import {PlatformDatabase,MemoryRateLimiter}from'./storage.mjs';
import {RoomNamespace}from'./rooms.mjs';
import {AdminConsole}from'./admin.mjs';
import {Publishing}from'./publishing.mjs';
import {TerracottaRelay}from'./terracotta-relay.mjs';
import {dirname,join}from'node:path';

const oldOrigins=new Set(['https://launcher-api.cogniticteam.com','https://launcher-signal.cogniticteam.com','https://community-api.cogniticteam.com']);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&a.length>=32&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const context={waitUntil(p){void p.catch(()=>{})},passThroughOnException(){},props:{}};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Date':new Date().toUTCString()}});

export function createPlatform(options){
  const env={...options.env};
  // Verification is local to this server, so the issuer queries Mojang directly.
  delete env.TORA_COMMUNITY_VERIFY_TOKEN;delete env.TORA_SELFHOST_ORIGIN;
  if(!env.TORA_SESSION_SECRET||!env.TORA_MULTIPLAYER_TICKET_SECRET||!env.TORA_COMMUNITY_SIGNING_JWK)throw new Error('platform_secrets_required');
  const origin=env.TORA_PUBLIC_ORIGIN||'https://154.8.230.216';
  const database=new PlatformDatabase(options.databasePath);
  env.XMCL_SESSION_SECRET=env.TORA_SESSION_SECRET;env.XMCL_MULTIPLAYER_TICKET_SECRET=env.TORA_MULTIPLAYER_TICKET_SECRET;
  env.CACHE=database.cache();env.RATE_LIMITER=new MemoryRateLimiter(120);env.REGISTRATION_LIMITER=new MemoryRateLimiter(5);
  const replayObjects=new Map();
  env.DPOP_REPLAY={idFromName:name=>name,get(name){
    name=String(name);if(replayObjects.has(name))return replayObjects.get(name);
    let alarm;let object;let tail=Promise.resolve();
    const serial=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result};
    const state={id:{toString:()=>name},storage:database.storage(name,at=>{clearTimeout(alarm);alarm=setTimeout(()=>void serial(()=>object.alarm()).catch(()=>{}),Math.max(100,Math.min(at-Date.now(),2147483647)));alarm.unref()})};
    object=new DpopReplayObject(state);const stub={fetch:request=>serial(()=>object.fetch(request)),close(){clearTimeout(alarm)}};replayObjects.set(name,stub);return stub;
  }};
  const accountStore=database.storage('accounts-v1');
  const accounts=new ToraAccountObject({storage:accountStore},env);
  const runtime=accountRuntime(new DurableAccountRepository(accountStore),env);
  env.ACCOUNTS={idFromName:name=>name,get:()=>accounts};
  const rooms=new RoomNamespace(database,env.TORA_MULTIPLAYER_TICKET_SECRET);env.MULTIPLAYER_ROOMS=rooms;rooms.restoreAlarms();
  const signaling=baseApp('signaling');
  signaling.use('*',async(c,next)=>{c.set('accountRuntime',runtime);await next()});
  signaling.route('/',createMultiplayerRoutes(async()=>runtime,{
    resolveAdmissionTelemetry:async()=>({record:async e=>env.CACHE.put(`admission:${e.admissionId}`,JSON.stringify(e),{expirationTtl:86400})}),
    resolveAttemptTelemetry:async()=>({record:async e=>{const key=`attempt:${e.accountId}:${e.attemptId}`;if(await env.CACHE.get(key))return'duplicate';await env.CACHE.put(key,JSON.stringify(e),{expirationTtl:86400});return'inserted'}}),
  }));
  signaling.post('/v1/rtc/official',xmclAuth(['account:read'],async()=>runtime),c=>c.json({stuns:['154.8.230.216:3478'],uris:[],servers:[],relayAvailable:false}));
  const publishing=new Publishing(database.db,options.publishDirectory||env.TORA_PUBLISH_DIR||join(dirname(options.databasePath),'publishing'),origin,env.TORA_RELEASE_SIGNING_KEY);
  const admin=new AdminConsole({database,origin,env,publishing,communityOrigin:options.communityOrigin,assetsPath:options.adminAssets,fetcher:options.adminFetcher});
  const sweep=setInterval(()=>{database.sweep();admin.sweep()},60000);sweep.unref();
  const publicCommunityEnv={COMMUNITY_ORIGIN:'https://community-origin.cogniticteam.com',COMMUNITY_GATEWAY_TOKEN:env.COMMUNITY_GATEWAY_TOKEN,RATE_LIMITER:new MemoryRateLimiter(120),WRITE_LIMITER:new MemoryRateLimiter(30)};
  async function fetchRequest(incoming){
    let request=incoming;let url=new URL(request.url);
    if(url.pathname.startsWith('/internal/platform')){
      if(!equal(request.headers.get('X-Tora-Proxy-Token'),env.TORA_INTERNAL_PROXY_TOKEN))return json({error:'unauthorized'},401);
      let original;try{original=new URL(request.headers.get('X-Tora-Original-Url'));if(!oldOrigins.has(original.origin)||original.pathname!==(url.pathname.slice('/internal/platform'.length)||'/')||original.search!==url.search)throw new Error()}catch{return json({error:'invalid_original_target'},400)}
      const headers=new Headers(request.headers);headers.delete('X-Tora-Proxy-Token');headers.delete('X-Tora-Original-Url');
      const ip=headers.get('X-Tora-Client-IP');headers.delete('X-Tora-Client-IP');if(ip&&/^[a-f0-9.:]{3,64}$/i.test(ip))headers.set('CF-Connecting-IP',ip);
      request=new Request(original, {method:request.method,headers,...(['GET','HEAD'].includes(request.method)?{}:{body:request.body,duplex:'half'})});url=original;
    }else if(request.headers.has('X-Tora-Proxy-Token'))return json({error:'invalid_proxy_route'},400);
    if(url.pathname==='/admin'||url.pathname.startsWith('/admin/'))return admin.fetch(request);
    if(['GET','HEAD'].includes(request.method)){
      const component=/^\/components\/terracotta\/(terracotta-0\.4\.2-(?:macos|windows|linux)-(?:arm64|x86_64)-pkg\.tar\.gz)$/.exec(url.pathname);
      if(component){
        try{const file=join(dirname(fileURLToPath(import.meta.url)),'components',component[1]);const length=statSync(file).size;return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file)),{headers:{'Content-Type':'application/gzip','Content-Length':String(length),'Cache-Control':'public,max-age=31536000,immutable','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}})}catch{return json({error:'component_unavailable'},503)}
      }
      if(url.pathname==='/latest'||url.pathname==='/v1/launcher/announcements'){
        const response=json(url.pathname==='/latest'?publishing.publicLatest(url.searchParams):publishing.publicPopups(url.searchParams));response.headers.set('Access-Control-Allow-Origin','*');return response;
      }
      if(url.pathname==='/downloads'||url.pathname==='/downloads/app.js')return admin.fetch(new Request(new URL(url.pathname,origin),request));
      const artifact=/^\/downloads\/(art_[a-f0-9]{32})\/([^/]+)$/.exec(url.pathname);
      if(artifact){try{return publishing.download(request,artifact[1],decodeURIComponent(artifact[2]))}catch{return json({error:'download_unavailable'},503)}}
    }
    if(url.pathname==='/health'&&equal(request.headers.get('Authorization')?.replace(/^Bearer /,''),env.COMMUNITY_GATEWAY_TOKEN))return fetch(new URL('/health',options.communityOrigin||'http://127.0.0.1:8765'),{headers:request.headers});
    if(url.pathname==='/health'){
      database.db.prepare('SELECT 1').get();return json({service:'tora-launcher-platform',status:'ok',storage:'sqlite',version:'1.0.0',agent:false,community:true,signaling:true});
    }
    if(url.pathname==='/flights')return json({xmclApiBaseUrl:origin,xmclBillingApiBaseUrl:origin,builtinAgent:false});
    if(url.pathname==='/config')return json({common:origin,ai:origin,signaling:origin,agent:false});
    if(url.pathname==='/source'&&['GET','HEAD'].includes(request.method)){
      if(!env.TORA_SOURCE_ARCHIVE)return json({error:'source_archive_pending'},503);
      const file=env.TORA_SOURCE_ARCHIVE;const length=statSync(file).size;
      return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file)),{headers:{'Content-Type':'application/gzip','Content-Length':String(length),'Content-Disposition':'attachment; filename="TORA-Minecraft-Launcher-source.tar.gz"','Cache-Control':'public, max-age=300'}});
    }
    if(url.pathname==='/v1/access'||url.pathname==='/v1/chat/completions')return json({error:'agent_removed',message:'Agent功能已移除。'},410);
    if(url.pathname==='/v1/community'||url.pathname.startsWith('/v1/community/')){
      if(equal(request.headers.get('Authorization')?.replace(/^Bearer /,''),env.COMMUNITY_GATEWAY_TOKEN))return fetch(new URL(url.pathname+url.search,options.communityOrigin||'http://127.0.0.1:8765'),{method:request.method,headers:request.headers,...(['GET','HEAD'].includes(request.method)?{}:{body:request.body,duplex:'half'})});
      return communityGateway(request,publicCommunityEnv,async(target,init)=>{
        const source=new URL(target instanceof Request?target.url:String(target));
        const local=new URL(source.pathname+source.search,options.communityOrigin||'http://127.0.0.1:8765');
        return fetch(local,init);
      });
    }
    if(url.pathname.startsWith('/v1/multiplayer/')||url.pathname==='/v1/rtc/official')return signaling.fetch(request,env,context);
    return api.fetch(request,env,context);
  }
  return{env,database,rooms,origin,admin,fetch:fetchRequest,close(){clearInterval(sweep);for(const o of replayObjects.values())o.close();rooms.shutdown();database.close()}};
}

export function servePlatform(platform,port=8770){
  const terracottaRelay=new TerracottaRelay();
  platform.admin.terracottaStats=()=>({rooms:terracottaRelay.rooms.size,connections:terracottaRelay.server.clients.size});
  const wsServer=new WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false});
  async function toRequest(req,body){
    const headers=new Headers();for(const [name,value]of Object.entries(req.headers)){if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value)}
    // This listener is loopback-only behind Caddy, which overwrites the client IP header.
    headers.set('CF-Connecting-IP',req.headers['x-forwarded-for']?.split(',')[0].trim()||req.socket.remoteAddress||'local');
    return new Request(new URL(req.url||'/',platform.origin),{method:req.method,headers,...(body?.length?{body}:{} )});
  }
  const server=createServer(async(req,res)=>{
    try{
      let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>1048576){res.writeHead(413);res.end();return}chunks.push(chunk)}
      const request=await toRequest(req,Buffer.concat(chunks));const response=await platform.fetch(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(req.method==='HEAD'||!response.body){await response.body?.cancel();res.end();return}
      const body=Readable.fromWeb(response.body);body.on('error',()=>res.destroy());res.on('close',()=>body.destroy());body.pipe(res);
    }catch(error){if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"service_error"}');console.error(JSON.stringify({event:'platform_request_failed',name:error?.name}))}
  });
  server.headersTimeout=15000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  server.on('upgrade',async(req,socket,head)=>{
    try{
      if(req.url==='/v1/terracotta/relay'){terracottaRelay.upgrade(req,socket,head);return}
      const request=await toRequest(req);const roomId=matchMultiplayerUpgrade(request);
      if(roomId===undefined||wsServer.clients.size>=512){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return}
      const url=new URL(request.url);url.pathname='/connect';const room=platform.rooms.get(roomId);const result=await room.fetch(new Request(url,request));
      if(result.status!==101||!result.webSocket){socket.end(`HTTP/1.1 ${result.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);return}
      wsServer.handleUpgrade(req,socket,head,ws=>room.attach(result.webSocket,ws));
    }catch{socket.destroy()}
  });
  server.on('close',()=>terracottaRelay.close());server.listen(port,'127.0.0.1');return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const secrets=JSON.parse(readFileSync(process.env.TORA_SECRETS_FILE||'/etc/tora-platform/secrets.json','utf8'));
  const platform=createPlatform({env:{...secrets,TORA_PUBLIC_ORIGIN:process.env.TORA_PUBLIC_ORIGIN||'https://154.8.230.216',TORA_SOURCE_ARCHIVE:process.env.TORA_SOURCE_ARCHIVE},databasePath:process.env.TORA_DATABASE||'/var/lib/tora-platform/platform.sqlite3'});
  const server=servePlatform(platform,Number(process.env.PORT)||8770);
  console.log(JSON.stringify({event:'tora_platform_started',port:Number(process.env.PORT)||8770}));
  for(const signal of['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{platform.close();process.exit(0)}));
}
