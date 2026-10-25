import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=JSON.parse(await fs.readFile(path.join(root,'scripts/xmcl-ui-baseline.json'),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const failures=[];let exact=0,styles=0,branding=0,serviceChanges=0,approvedStyles=0;
for(const file of baseline.files){
 const target=path.join(root,'xmcl/xmcl-keystone-ui',file.path);
 try{
  const source=await fs.readFile(target);
  if(file.stylesSha256){
   const blocks=[...source.toString().matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match=>match[0]).join('\n');
   if(sha(blocks)===file.stylesSha256)styles++;else if(file.approvedReason && sha(blocks)===file.approvedStylesSha256)approvedStyles++;else failures.push(`${file.path}: 样式块已偏离上游`);
  }
  if(sha(source)===file.sha256)exact++;
  else if(file.brandingOnly)branding++;
  else if(file.approvedSha256===sha(source))serviceChanges++;
  else failures.push(`${file.path}: 非品牌源码已偏离上游`);
 }catch(error){failures.push(`${file.path}: ${error.message}`)}
}
const result={upstreamCommit:baseline.commit,checked:baseline.files.length,unchangedFiles:exact,unchangedVueStyles:styles,brandingTemplates:branding,approvedChanges:serviceChanges,approvedStyleChanges:approvedStyles,failures};
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
