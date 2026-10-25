import { open as openZip, walkEntriesGenerator, readEntryBuffered } from '../../packages/unzip'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, posix, resolve } from 'node:path'
import { lstat, writeFile, statfs } from 'node:fs/promises'
const exec = promisify(execFile)
export async function prepareMacUpdate(archive:string,stage:string,version:string){
  const zip=await openZip(archive);let count=0,total=0
  try{for await(const entry of walkEntriesGenerator(zip)){
    const name=entry.fileName;count++;total+=entry.uncompressedSize
    if(count>100000||total>3*1024**3||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||!name.startsWith('TORA Minecraft Launcher.app/')&&!name.startsWith('__MACOSX/'))throw new Error('更新压缩包包含无效路径。')
    const mode=(entry.externalFileAttributes>>>16)&0o170000
    if(mode===0o120000){if(entry.uncompressedSize>4096)throw new Error('更新压缩包链接无效。');const target=(await readEntryBuffered(zip,entry)).toString('utf8'),result=posix.normalize(posix.join(posix.dirname(name),target));if(posix.isAbsolute(target)||!result.startsWith('TORA Minecraft Launcher.app/'))throw new Error('更新压缩包含越界链接。')}
  }}finally{zip.close()}
  const disk=await statfs(stage);if(disk.bavail*disk.bsize<total*1.1)throw new Error('应用磁盘空间不足以展开更新包。')
  await exec('/usr/bin/ditto',['-x','-k',archive,stage],{timeout:120000})
  const bundle=join(stage,'TORA Minecraft Launcher.app'),plist=join(bundle,'Contents/Info.plist')
  const identifier=(await exec('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw',plist])).stdout.trim()
  const actual=(await exec('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw',plist])).stdout.trim()
  if(identifier!=='app.tora.minecraft'||actual!==version||(await lstat(join(bundle,'Contents/MacOS/TORA Minecraft Launcher'))).isSymbolicLink())throw new Error('更新包的应用标识或版本不匹配。')
  return bundle
}
export async function assertMacUpdateTarget(bundle:string){const id=(await exec('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw',join(bundle,'Contents/Info.plist')])).stdout.trim();if(id!=='app.tora.minecraft')throw new Error('请在正式版 TORA 启动器中安装更新。')}
export async function markUpdateHealthy(appData:string,version:string){
  const file=process.env.TMCL_UPDATE_HEALTH_FILE,token=process.env.TMCL_UPDATE_HEALTH_TOKEN
  if(!file||!token||!/^[a-f0-9]{64}$/.test(token)||resolve(file)!==resolve(appData,'updates','health.json'))return
  await writeFile(file,JSON.stringify({token,version,ready:Date.now()}),{mode:0o600})
}
/** Self-contained: the helper remains usable after the installed bundle is renamed. */
export const updateInstallerScript=String.raw`
const fs=require('node:fs/promises'),cp=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
(async()=>{
 const s=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 const status=async(state,message)=>{await fs.writeFile(s.status,JSON.stringify({state,message,version:s.version,time:Date.now()}),{mode:384})};
 let moved=false,installed=false,child;
 try{
  await status('waiting','正在等待启动器退出。');
  for(let i=0;i<240&&alive(s.oldPid);i++)await sleep(500);
  if(alive(s.oldPid))throw new Error('原启动器未退出，未替换任何文件。');
  await fs.rename(s.target,s.backup);moved=true;
  await fs.rename(s.payload,s.target);installed=true;
  if(s.mode==='image')await fs.chmod(s.target,493);
  await fs.rm(s.health,{force:true});
  const environment={...process.env,TMCL_UPDATE_HEALTH_FILE:s.health,TMCL_UPDATE_HEALTH_TOKEN:s.token};delete environment.ELECTRON_RUN_AS_NODE;
  child=cp.spawn(s.executable,[],{detached:true,stdio:'ignore',env:environment});let childError=false;child.on('error',()=>{childError=true});
  await status('verifying','新版本正在启动，等待健康确认。');
  let okay=false;
  for(let i=0;i<120;i++){await sleep(500);if(childError||child.exitCode!==null||child.signalCode!==null)break;try{const h=JSON.parse(await fs.readFile(s.health,'utf8'));if(h.token===s.token&&h.version===s.version){okay=true;break}}catch{}}
  if(!okay)throw new Error('新版本未通过启动检查。');
  await sleep(3000);if(child.exitCode!==null||child.signalCode!==null)throw new Error('新版本启动后异常退出。');
  child.unref();await status('installed','更新完成；上一版本已保留。');
 }catch(e){
  if(child?.pid&&child.exitCode===null&&child.signalCode===null&&alive(child.pid)){try{child.kill('SIGTERM')}catch{};await sleep(1000);if(child.exitCode===null&&child.signalCode===null&&alive(child.pid))try{child.kill('SIGKILL')}catch{}}
  if(installed)await fs.rename(s.target,s.failed).catch(()=>{});
  if(moved){await fs.rename(s.backup,s.target);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.TMCL_UPDATE_HEALTH_FILE;delete env.TMCL_UPDATE_HEALTH_TOKEN;const old=cp.spawn(s.executable,[],{detached:true,stdio:'ignore',env});old.on('error',()=>{});old.unref();}
  await status(moved?'rolled-back':'failed',moved?'更新失败，已恢复原版本：'+e.message:e.message);
 }
})().catch(()=>{process.exitCode=1});
`
