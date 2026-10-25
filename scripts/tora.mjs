import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cwd=path.join(root,'xmcl');
const children=new Set();
async function rendererReady(){try{const r=await fetch('http://localhost:3000',{signal:AbortSignal.timeout(1000)});return r.ok&&(await r.text()).includes('TORA')}catch{return false}}
async function mainReady(){try{const r=await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(1000)});return r.ok&&(await r.json()).some(page=>page.url?.startsWith('http://localhost:3000/'))}catch{return false}}
function run(args,extra={}){return new Promise((resolve,reject)=>{const child=spawn('pnpm',args,{cwd,stdio:'inherit',env:{...process.env,...extra}});children.add(child);child.once('error',reject);child.once('exit',(code,signal)=>{children.delete(child);if(code===0||signal==='SIGTERM'){resolve()}else{reject(new Error(`pnpm ${args.join(' ')} 退出码 ${code}`))}})})}
function cleanup(){for(const child of children)child.kill('SIGTERM')}
process.once('SIGINT',()=>{cleanup();process.exit(130)});process.once('SIGTERM',()=>{cleanup();process.exit(143)});
async function withRenderer(mainArgs){
 if(await mainReady()){console.log('TORA 开发应用已在运行，请使用现有窗口。');return}
 let rendererError;
 const renderer=await rendererReady()?Promise.resolve():run(['dev:renderer']);
 renderer.catch(error=>{rendererError=error;console.error(error.message);cleanup()});
 for(let i=0;i<120;i++){
   if(rendererError)throw rendererError;
   if(await rendererReady())break;
   if(i===119)throw new Error('前端开发服务未能启动，请检查3000端口');
   await new Promise(resolve=>setTimeout(resolve,500));
 }
 await run(mainArgs);cleanup();await renderer;
}
try {
 const mode=process.argv[2];
 if(mode==='build'){await run(['build:renderer']);await run(['--prefix=xmcl-electron-app','compile'])}
 else if(mode==='start'){
   // dev:main and compile share this output. A development bundle still
   // requires Vite even when it is opened through npm start.
   const bundle=await readFile(path.join(cwd,'xmcl-electron-app/dist/index.js'),'utf8');
   if(/\bHAS_DEV_SERVER\d*\s*=\s*(?:true|!0)\b/.test(bundle)){
     console.log('检测到开发版程序，正在检查并启动界面服务…');
     await withRenderer(['--prefix=xmcl-electron-app','exec','electron','--remote-debugging-port=9222','dist/index.js']);
   }else await run(['--prefix=xmcl-electron-app','exec','electron','dist/index.js']);
 }
 else if(mode==='dev')await withRenderer(['dev:main']);
 else throw new Error('用法: node scripts/tora.mjs dev|build|start');
}catch(error){console.error(error.message);cleanup();process.exitCode=1}
