import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
const config=await fs.readFile('/Users/zhenxun/Library/Preferences/.wrangler/config/default.toml','utf8');
const token=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!token)throw new Error('Wrangler authentication missing');

const endpoint='https://api.cloudflare.com/client/v4/accounts/22ec4cb4ad938c630e02a997e7d9b62d/calls/turn_keys';
const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token}});const data=await response.json();
console.log(JSON.stringify({kind:'turn-access',status:response.status,success:data.success,errors:data.errors?.map(e=>({code:e.code,message:e.message}))}));
if(data.success){
 let existing=data.result?.find?.(item=>item.name==='TORA Minecraft Launcher');
 if(!existing){const created=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'TORA Minecraft Launcher'})});const result=await created.json();if(result.success){existing=result.result;writeFileSync('server/.secrets/turn-key.json',JSON.stringify(existing),{mode:0o600});console.log(JSON.stringify({turnCreated:true,id:existing.keyId||existing.uid||existing.id,tokenSaved:!!existing.apiToken}));}else console.log(JSON.stringify({turnCreated:false,status:created.status,errors:result.errors}));}
 else console.log(JSON.stringify({turnExists:true,id:existing.keyId||existing.uid||existing.id}));
}
