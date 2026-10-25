import fs from 'node:fs/promises';
const config=await fs.readFile('/Users/zhenxun/Library/Preferences/.wrangler/config/default.toml','utf8');
const token=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!token)throw new Error('Wrangler authentication missing');
for(const item of [['zone','/zones?name=cogniticteam.com'],['subdomain','/accounts/22ec4cb4ad938c630e02a997e7d9b62d/workers/subdomain'],['r2','/accounts/22ec4cb4ad938c630e02a997e7d9b62d/r2/buckets']]){
 const r=await fetch('https://api.cloudflare.com/client/v4'+item[1],{headers:{Authorization:'Bearer '+token}});const data=await r.json();
 console.log(JSON.stringify({kind:item[0],status:r.status,success:data.success,result:item[0]==='zone'?data.result?.map(z=>({id:z.id,name:z.name,status:z.status})):item[0]==='subdomain'?data.result:{enabled:data.success,count:data.result?.buckets?.length},errors:data.errors?.map(e=>({code:e.code,message:e.message}))}));
}
