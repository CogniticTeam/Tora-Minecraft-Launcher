import {build}from'esbuild';
import {fileURLToPath}from'node:url';
import {dirname,resolve}from'node:path';
import {cp}from'node:fs/promises';
const here=dirname(fileURLToPath(import.meta.url));
await build({entryPoints:[resolve(here,'entry.mjs')],outfile:resolve(here,'dist/platform.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',minify:false,sourcemap:false,external:['bufferutil','utf-8-validate'],plugins:[{name:'node-platform-transport',setup(build){build.onResolve({filter:/^cloudflare:sockets$/},()=>({path:'cloudflare:sockets',namespace:'node-platform'}));build.onLoad({filter:/.*/,namespace:'node-platform'},()=>({contents:'export function connect(){throw new Error("Cloudflare transport is unavailable on the dedicated server")}',loader:'js'}))}}],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}});
await cp(resolve(here,'../admin'),resolve(here,'dist/admin'),{recursive:true});
