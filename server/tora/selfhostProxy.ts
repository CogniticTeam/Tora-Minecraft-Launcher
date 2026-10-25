/** Compatibility-only Worker: all processing and persistence live on the dedicated server. */
export async function forwardToSelfHost(request:Request,env:any):Promise<Response>{
  if(env.TORA_SELFHOST_ORIGIN!=='https://154.8.230.216'||!env.TORA_INTERNAL_PROXY_TOKEN)return Response.json({error:'selfhost_not_configured'},{status:503});
  const url=new URL(request.url);
  if(request.headers.get('Upgrade')?.toLowerCase()==='websocket')return Response.json({error:'launcher_update_required',origin:env.TORA_SELFHOST_ORIGIN},{status:426});
  if(url.pathname==='/source'&&request.method==='GET')return Response.redirect(env.TORA_SELFHOST_ORIGIN+'/source',307);
  const headers=new Headers();for(const key of['authorization','dpop','content-type','accept','origin','idempotency-key']){const value=request.headers.get(key);if(value)headers.set(key,value)}
  headers.set('X-Tora-Proxy-Token',env.TORA_INTERNAL_PROXY_TOKEN);headers.set('X-Tora-Original-Url',url.href);headers.set('X-Tora-Client-IP',request.headers.get('CF-Connecting-IP')||'local');
  let body:ArrayBuffer|undefined;
  if(request.body){const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1048576){await reader.cancel();return Response.json({error:'body_too_large'},{status:413})}chunks.push(next.value)}}finally{reader.releaseLock()}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}body=bytes.buffer}
  try{const{socketOriginFetch}=await import('./communityOriginTransport.ts');return await socketOriginFetch(new URL('/internal/platform'+url.pathname+url.search,'https://community-origin.cogniticteam.com'),{method:request.method,headers,body,signal:AbortSignal.timeout(25000)})}
  catch{return Response.json({error:'selfhost_temporarily_unavailable'},{status:502,headers:{'Retry-After':'3','Cache-Control':'no-store'}})}
}
