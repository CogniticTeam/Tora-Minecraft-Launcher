import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createPlatform, servePlatform } from './dist/platform.mjs';
import { issueAdminCode } from './admin-auth.mjs';

const cfg = JSON.parse(readFileSync('/tmp/tmcl-admin-private/staging.json', 'utf8'));
mkdirSync('/tmp/tmcl-admin-staging', { recursive: true, mode: 0o700 });
const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const app = createPlatform({ env: { TORA_SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(), TORA_MULTIPLAYER_TICKET_SECRET: crypto.randomUUID() + crypto.randomUUID(), TORA_COMMUNITY_SIGNING_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', key.privateKey)), COMMUNITY_GATEWAY_TOKEN: cfg.gateway, COMMUNITY_ADMIN_TOKEN: cfg.admin, TORA_PUBLIC_ORIGIN: 'http://127.0.0.1:18770', TORA_ADMIN_STAGING: '1', TORA_ADMIN_PASSWORD_HASH: cfg.passwordHash }, databasePath: '/tmp/tmcl-admin-staging/platform.sqlite3', communityOrigin: 'http://127.0.0.1:18765' });
const code = issueAdminCode(app.database.db, { operator: 'owner', label: '绪山同学' });
writeFileSync('/tmp/tmcl-admin-private/staging-login-code', code, { mode: 0o600 });
const server = servePlatform(app, 18770);
console.log('TMCL isolated acceptance: http://127.0.0.1:18770/admin/');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { app.close(); process.exit(0); }));
