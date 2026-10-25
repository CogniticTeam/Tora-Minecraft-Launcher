import api from '../tora/api.ts';
import { ToraAccountObject as Accounts } from '../tora/accounts.ts';
import { DpopReplayObject as Replay } from '../src/cloudflare/dpopReplay.ts';
import { timingSafeEqual } from 'node:crypto';
const encoder=new TextEncoder();
function authorized(request:Request,env:any){const value=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';const expected=env.TORA_MIGRATION_TOKEN||'';return Date.now()<Number(env.TORA_MIGRATION_DEADLINE)&&expected.length>=40&&value.length===expected.length&&timingSafeEqual(encoder.encode(value),encoder.encode(expected));}
const failure=()=>new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
export class ToraAccountObject extends Accounts {
  private transfer:Promise<unknown>=Promise.resolve();
  constructor(private state:any,private migrationEnv:any){super(state,migrationEnv)}
  override fetch(request:Request):Promise<Response>{const result=this.transfer.then(async()=>{
    if(new URL(request.url).pathname==='/_tora_migration/accounts'){
      if(!authorized(request,this.migrationEnv))return failure();
      if(request.method!=='POST')return new Response(null,{status:405});
      await this.state.storage.put('migration:frozen',{at:new Date().toISOString()});
      const environment:Record<string,string>={};
      for(const key of ['TORA_SESSION_SECRET','TORA_COMMUNITY_SIGNING_JWK','TORA_MULTIPLAYER_TICKET_SECRET','TORA_MICROSOFT_CLIENT_ID','TORA_MODRINTH_CLIENT_ID','TORA_MODRINTH_CLIENT_SECRET','TORA_GOOGLE_CLIENT_ID','TORA_GOOGLE_CLIENT_SECRET','TORA_DISCORD_CLIENT_ID','TORA_DISCORD_CLIENT_SECRET','TORA_OAUTH_REDIRECT_URIS'])if(typeof this.migrationEnv[key]==='string')environment[key]=this.migrationEnv[key];
      return Response.json({version:1,createdAt:new Date().toISOString(),accounts:[...await this.state.storage.list()],environment},{headers:{'Cache-Control':'no-store'}});
    }
    if(await this.state.storage.get('migration:frozen'))return Response.json({error:'migration_in_progress'},{status:503,headers:{'Retry-After':'30'}});
    return super.fetch(request);
  });this.transfer=result.catch(()=>{});return result;}
}
export class DpopReplayObject extends Replay {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private migrationState:any,private migrationEnv:any){super(migrationState)}
  override fetch(request:Request):Promise<Response>{const result=this.queue.then(async()=>{
    if(new URL(request.url).pathname==='/_tora_migration/replay'){
      if(!authorized(request,this.migrationEnv))return failure();
      return Response.json({entries:await this.migrationState.storage.get('entries')||{}},{headers:{'Cache-Control':'no-store'}});
    }
    if(this.migrationEnv.TORA_MIGRATION_FREEZE==='1')return new Response('Migration in progress',{status:503});
    return super.fetch(request);
  });this.queue=result.catch(()=>{});return result;}
}
export default {async fetch(request:Request,env:any,ctx:any){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/_tora_migration/')){
    if(!authorized(request,env))return failure();
    if(url.pathname==='/_tora_migration/accounts')return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts-v1')).fetch(request);
    if(url.pathname==='/_tora_migration/cache'){
      const result=await env.CACHE.list({limit:20,...(url.searchParams.get('cursor')?{cursor:url.searchParams.get('cursor')}: {})});
      const items=await Promise.all(result.keys.map(async(key:any)=>({key:key.name,value:await env.CACHE.get(key.name),expiration:key.expiration})));
      return Response.json({items,cursor:result.list_complete?null:result.cursor},{headers:{'Cache-Control':'no-store'}});
    }
    if(url.pathname==='/_tora_migration/replays'){
      const start=Number(url.searchParams.get('start')||0);if(!Number.isInteger(start)||start<0||start>255)return failure();
      const items=await Promise.all(Array.from({length:Math.min(24,256-start)},async(_,i)=>{const name=`dpop-${start+i}`;const stub=env.DPOP_REPLAY.get(env.DPOP_REPLAY.idFromName(name));const response=await stub.fetch(new Request(new URL('/_tora_migration/replay',url),{headers:{Authorization:request.headers.get('Authorization')!}}));if(!response.ok)throw new Error('snapshot_failed');return {namespace:name,...await response.json() as object}}));
      return Response.json({items,next:start+items.length<256?start+items.length:null},{headers:{'Cache-Control':'no-store'}});
    }
    return failure();
  }
  return api.fetch(request,env,ctx);
}};
