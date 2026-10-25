import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const config=await fs.readFile('/Users/zhenxun/Library/Preferences/.wrangler/config/default.toml','utf8');
const token=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!token)throw new Error('Existing Wrangler authentication is unavailable');
const cwd=path.resolve(import.meta.dirname,'..');
const child=spawn(process.execPath,[path.join(cwd,'node_modules/wrangler/bin/wrangler.js'),...process.argv.slice(2)],{cwd,env:{...process.env,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:'22ec4cb4ad938c630e02a997e7d9b62d'},stdio:'inherit'});
child.on('exit',code=>process.exitCode=code??1);
