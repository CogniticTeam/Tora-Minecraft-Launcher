import { DEFAULT_XMCL_API_BASE_URL, type ReleaseInfo, type UpdateCapability } from '@xmcl/runtime-api'
import type { LauncherAppUpdater, DownloadUpdateOptions } from '@xmcl/runtime/app'
import { gt, valid } from 'semver'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, writeFile, rename, rm, access, statfs } from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { verifyReleaseFile, type SignedReleaseFile } from './updateSecurity'
import { prepareMacUpdate, updateInstallerScript, assertMacUpdateTarget } from './updateInstaller'

export class ToraUpdater implements LauncherAppUpdater {
  readonly capability: UpdateCapability
  private root: string
  constructor(private readonly app: {version:string;appDataPath?:string;fetch?:typeof fetch;quit?:()=>Promise<void>;updateKey?:{keyId:string;publicKey:string}}, private readonly canInstall:()=>Promise<boolean> = async()=>true) {
    this.root=join(app.appDataPath||dirname(process.execPath),'updates')
    this.capability={automatic:!!app.appDataPath&&!!app.quit&&!(process as NodeJS.Process & {defaultApp?:boolean}).defaultApp&&(['darwin','win32'].includes(process.platform)||process.platform==='linux'&&!!process.env.APPIMAGE),manualCheck:true,reason:'not-configured'}
  }
  async preferences(){const preferences=await readFile(join(this.root,'preferences.json'),'utf8').then(JSON.parse).catch(()=>({channel:'stable'}));const status=await readFile(join(this.root,'status.json'),'utf8').then(JSON.parse).catch(()=>undefined);return{channel:preferences.channel==='beta'?'beta':'stable',version:this.app.version,status}}
  async setChannel(channel:string){if(!['stable','beta'].includes(channel))throw new Error('更新通道无效。');await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(join(this.root,'preferences.json'),JSON.stringify({channel}),{mode:0o600});return this.preferences()}
  async checkUpdateTask():Promise<ReleaseInfo>{
    const {channel}=await this.preferences(),url=new URL('/latest',DEFAULT_XMCL_API_BASE_URL)
    for(const [key,value]of Object.entries({version:this.app.version,platform:process.platform,arch:process.arch,channel}))url.searchParams.set(key,value)
    const response=await(this.app.fetch||fetch)(url.href,{signal:AbortSignal.timeout(15000),redirect:'error'})
    if(!response.ok)throw new Error('TORA 更新信息请求失败：'+response.status)
    const data=await response.json() as Partial<ReleaseInfo>
    const name=typeof data.name==='string'&&valid(data.name)?data.name:this.app.version
    const releaseChannel=data.channel==='beta'?'beta':'stable'
    const files=Array.isArray(data.files)?data.files.slice(0,12).filter(f=>{try{const u=new URL(f.url);return typeof f.name==='string'&&u.origin===new URL(DEFAULT_XMCL_API_BASE_URL).origin&&!u.search&&!u.hash&&!u.username&&!u.password&&/^\/downloads\/art_[a-f0-9]{32}\//.test(u.pathname)}catch{return false}}):[]
    const signed=files.some(f=>verifyReleaseFile(name,releaseChannel,f as SignedReleaseFile,this.app.updateKey)&&this.supports(f as SignedReleaseFile))
    return{name,body:typeof data.body==='string'?data.body.slice(0,50000):'TORA 更新',date:typeof data.date==='string'?data.date:'',channel:releaseChannel,files,newUpdate:!!valid(this.app.version)&&!!valid(name)&&gt(name,this.app.version)&&files.length>0,operation:signed&&this.capability.automatic?'autoupdater':'manual'}
  }
  private supports(file:SignedReleaseFile){return file.platform===process.platform&&file.arch===process.arch&&(process.platform==='darwin'?file.kind==='zip':process.platform==='win32'?['exe','msi'].includes(file.kind):file.kind==='AppImage'&&!!process.env.APPIMAGE)}
  private select(info?:ReleaseInfo){if(!info||!valid(info.name)||!gt(info.name,this.app.version))throw new Error('请先检查并选择适用的新版本。');const file=info.files.find(f=>this.supports(f as SignedReleaseFile)&&verifyReleaseFile(info.name,info.channel||'stable',f as SignedReleaseFile,this.app.updateKey)) as SignedReleaseFile|undefined;if(!file)throw new Error('没有通过发布签名验证的自动更新包，请使用手动下载页面。');return file}
  async downloadUpdate(info?:ReleaseInfo,options?:DownloadUpdateOptions){
    const file=this.select(info);await mkdir(this.root,{recursive:true,mode:0o700})
    const target=join(this.root,file.sha256+'.'+file.kind),part=target+'.part'
    const signal=options?.abortSignal||AbortSignal.timeout(15*60000)
    const response=await(this.app.fetch||fetch)(file.url,{signal,redirect:'error'})
    if(!response.ok||!response.body)throw new Error('更新包下载失败，请重试。')
    const handle=await open(part,'w',0o600),hash=createHash('sha256'),progress={progress:0,total:file.size,url:file.url}
    options?.tracker?.({phase:'download-update.full',payload:{progress}})
    try{const reader=response.body.getReader();try{while(true){signal.throwIfAborted();const r=await reader.read();if(r.done)break;progress.progress+=r.value.length;if(progress.progress>file.size)throw new Error('更新包大小不符。');hash.update(r.value);await handle.writeFile(r.value)}}finally{await reader.cancel()}await handle.sync()}catch(e){await handle.close();await rm(part,{force:true});throw e}
    await handle.close()
    if(progress.progress!==file.size||hash.digest('hex')!==file.sha256){await rm(part,{force:true});throw new Error('更新包完整性校验失败，未进行安装。')}
    await rename(part,target);await writeFile(join(this.root,'ready.json'),JSON.stringify({version:info!.name,channel:info!.channel||'stable',file,target}),{mode:0o600})
  }
  async installUpdateAndQuit(info?:ReleaseInfo){
    if(!await this.canInstall())throw new Error('请先退出游戏，再安装启动器更新。')
    const file=this.select(info),ready=JSON.parse(await readFile(join(this.root,'ready.json'),'utf8').catch(()=>{throw new Error('请先下载并校验更新包。')}))
    const downloaded=join(this.root,file.sha256+'.'+file.kind),hash=createHash('sha256')
    if(ready.version!==info!.name||ready.target!==downloaded)throw new Error('缓存更新包与当前版本不符，请重新下载。')
    for await(const bytes of createReadStream(downloaded))hash.update(bytes)
    if(hash.digest('hex')!==file.sha256)throw new Error('缓存更新包已改变，停止安装。')
    if(process.platform==='win32'){
      const exe=file.kind==='msi'?'msiexec.exe':downloaded,args=file.kind==='msi'?['/i',downloaded,'/passive','/norestart']:[]
      const child=spawn(exe,args,{detached:true,stdio:'ignore',windowsHide:false});await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await this.app.quit?.();return
    }
    const target=process.platform==='darwin'?dirname(dirname(dirname(process.execPath))):process.env.APPIMAGE!
    if(process.platform==='darwin'&&!target.endsWith('.app'))throw new Error('请在正式安装的启动器中更新。')
    if(process.platform==='darwin')await assertMacUpdateTarget(target)
    await access(dirname(target),constants.W_OK)
    const disk=await statfs(dirname(target));if(disk.bavail*disk.bsize<file.size*4)throw new Error('应用所在磁盘空间不足，请释放空间后更新。')
    const nonce=randomBytes(32).toString('hex'),stage=join(dirname(target),'.tmcl-update-'+nonce.slice(0,12));await mkdir(stage,{mode:0o700})
    let payload:string
    if(process.platform==='darwin'){try{payload=await prepareMacUpdate(downloaded,stage,info!.name)}catch(e){await rm(stage,{recursive:true,force:true});throw e}}
    else{payload=join(stage,'TMCL.AppImage');const output=await open(payload,'wx',0o700);try{for await(const b of createReadStream(downloaded))await output.writeFile(b)}finally{await output.close()}}
    const spec={mode:process.platform==='darwin'?'bundle':'image',oldPid:process.pid,target,payload,backup:target+'.tmcl-previous-'+nonce.slice(0,12),failed:target+'.tmcl-failed-'+nonce.slice(0,12),executable:process.platform==='darwin'?join(target,'Contents/MacOS/TORA Minecraft Launcher'):target,health:join(this.root,'health.json'),token:nonce,status:join(this.root,'status.json'),version:info!.name}
    const script=join(this.root,'install.cjs'),configuration=join(this.root,'install.json');await writeFile(script,updateInstallerScript,{mode:0o600});await writeFile(configuration,JSON.stringify(spec),{mode:0o600})
    const child=spawn(process.platform==='linux'?process.env.APPIMAGE!:process.execPath,[script,configuration],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},detached:true,stdio:'ignore'});await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await this.app.quit?.()
  }
}
