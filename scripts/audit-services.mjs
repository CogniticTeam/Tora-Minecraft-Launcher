import fs from 'node:fs/promises';
import path from 'node:path';
const roots=['xmcl/xmcl-runtime','xmcl/xmcl-runtime-api/src','xmcl/xmcl-keystone-ui/src','xmcl/xmcl-electron-app/main'];
const blocked=/https?:\/\/(?:[\w.-]*\.)?xmcl\.(?:app|cn)(?:[/:]|$)|https?:\/\/xmcl(?:-core-api\.azurewebsites\.net|\.blob\.core\.windows\.net)/gi;
const failures=[];
async function scan(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(['node_modules','dist'].includes(entry.name))continue;const file=path.join(folder,entry.name);if(entry.isDirectory())await scan(file);else if(/\.(ts|vue|html)$/.test(entry.name)&&!entry.name.endsWith('.test.ts')){const text=await fs.readFile(file,'utf8');if([...text.matchAll(blocked)].length)failures.push(file)}}}
for(const folder of roots)await scan(folder);
console.log(JSON.stringify({retiredXmclServiceUrls:failures.length,files:failures},null,2));
if(failures.length)process.exitCode=1;
