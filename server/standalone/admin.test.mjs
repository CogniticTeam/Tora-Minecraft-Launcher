import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatform } from './dist/platform.mjs';
import { PlatformDatabase } from './storage.mjs';
import { issueAdminCode, loginAdmin, getAdminSession, hashAdminPassword, verifyAdminPassword } from './admin-auth.mjs';
import { Publishing } from './publishing.mjs';

const origin = 'https://admin.example.test';
async function fixture(enabled = true, passwordHash = '') {
  const dir = mkdtempSync(join(tmpdir(), 'tmcl-admin-test-'));
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = { TORA_PUBLIC_ORIGIN: origin, TORA_ADMIN_PASSWORD_HASH: passwordHash, TORA_SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(), TORA_MULTIPLAYER_TICKET_SECRET: crypto.randomUUID() + crypto.randomUUID(), TORA_COMMUNITY_SIGNING_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', key.privateKey)), COMMUNITY_ADMIN_TOKEN: enabled ? crypto.randomUUID() : '', COMMUNITY_GATEWAY_TOKEN: crypto.randomUUID() };
  const options = { env, databasePath: join(dir, 'db.sqlite'), adminFetcher: async () => Response.json({ data: { handled: true } }) };
  const app = createPlatform(options);
  const request = (path, { method = 'GET', body, cookie, csrf, from = origin } = {}) => app.fetch(new Request(origin + '/admin' + path, { method, headers: { Origin: from, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { app, options, request, dir, close() { app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('admin login code is single-use, short-lived, and stores only hashes', async () => {
  const f = await fixture();
  try {
    const code = issueAdminCode(f.app.database.db), result = loginAdmin(f.app.database.db, code);
    assert.ok(result); assert.equal(loginAdmin(f.app.database.db, code), null);
    assert.equal(f.app.database.db.prepare('SELECT hash FROM admin_sessions').get().hash.includes(result.token), false);
    assert.equal(getAdminSession(f.app.database.db, result.token, Date.now() + 31 * 60000), null);
    assert.equal(getAdminSession(f.app.database.db, result.token, Date.now() + 9 * 3600000), null);
    const expired = issueAdminCode(f.app.database.db, {}, Date.now() - 11 * 60000); assert.equal(loginAdmin(f.app.database.db, expired), null);
  } finally { f.close(); }
});
test('admin data requires authentication and mutations require same-origin CSRF', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/posts')).status, 401);
    const code = issueAdminCode(f.app.database.db);
    assert.equal((await f.request('/api/login', { method: 'POST', body: { code }, from: 'https://evil.example' })).status, 403);
    const r = await f.request('/api/login', { method: 'POST', body: { code } }); assert.equal(r.status, 200);
    const cookie = r.headers.get('Set-Cookie').split(';')[0], session = await r.json();
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(r.headers.get('Set-Cookie').includes(flag));
    assert.equal((await f.request('/api/actions', { method: 'POST', cookie, body: {} })).status, 403);
    assert.equal((await f.request('/api/actions', { method: 'POST', cookie, csrf: session.csrf, body: {} })).status, 200);
    assert.equal((await f.request('/api/session', { cookie })).status, 200);
    await f.request('/api/logout', { method: 'POST', cookie, csrf: session.csrf, body: {} });
    assert.equal((await f.request('/api/session', { cookie })).status, 401);
    const staticPage = await f.request('/'); assert.equal(staticPage.status, 200); assert.ok(staticPage.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
    assert.equal((await f.app.fetch(new Request('https://launcher-api.cogniticteam.com/admin/'))).status, 404);
  } finally { f.close(); }
});
test('unconfigured console fails closed instead of allowing a default password', async () => { const f = await fixture(false); try { assert.equal((await f.request('/api/login', { method: 'POST', body: { code: 'admin' } })).status, 503); } finally { f.close(); } });
test('session survives a platform restart without persisting its raw token', async () => {
  const f = await fixture(); let second;
  try { const code = issueAdminCode(f.app.database.db), r = await f.request('/api/login', { method: 'POST', body: { code } }); const cookie = r.headers.get('Set-Cookie').split(';')[0]; f.app.close(); second = createPlatform(f.options); const r2 = await second.fetch(new Request(origin + '/admin/api/session', { headers: { Cookie: cookie } })); assert.equal(r2.status, 200); } finally { second?.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('publishing validates upload bounds, format, digest, range and withdrawal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmcl-publish-test-')), database = new PlatformDatabase(join(dir, 'db.sqlite'));
  try {
    const p = new Publishing(database.db, join(dir, 'files'), origin), session = { operator: 'owner' };
    const release = p.createRelease({ version: '0.10.0', title: 'TMCL 0.10.0', notes: '本地隔离验收', channel: 'stable' }, session);
    assert.throws(() => p.publish(release.id, { revision: 1 }), /至少一个/);
    assert.throws(() => p.startUpload(release.id, { platform: 'darwin', arch: 'arm64', kind: 'zip', name: '../bad.zip', size: 32 }), /无效/);
    const file = p.startUpload(release.id, { platform: 'darwin', arch: 'arm64', kind: 'zip', name: 'tmcl-test.zip', size: 32 });
    await assert.rejects(() => p.chunk(file.id, 1, Buffer.alloc(32)), /进度/);
    const bytes = Buffer.alloc(32); bytes.write('PK'); await p.chunk(file.id, 0, bytes);
    // Simulate a crash after the final rename but before SQLite marks the upload ready.
    renameSync(join(dir, 'files', file.id + '.part'), join(dir, 'files', file.id + '.blob'));
    const complete = await p.finish(file.id); assert.match(complete.sha256, /^[a-f0-9]{64}$/);
    assert.equal(p.download(new Request(origin), file.id, file.name).status, 404);
    const published = p.publish(release.id, { revision: 1 });
    assert.equal(p.publicLatest(new URLSearchParams({ version: '0.2.0' })).newUpdate, true);
    assert.equal(p.publicLatest(new URLSearchParams({ version: '1.0.0' })).newUpdate, false);
    const download = p.download(new Request(origin, { headers: { Range: 'bytes=2-9' } }), file.id, file.name); assert.equal(download.status, 206); assert.equal((await download.arrayBuffer()).byteLength, 8);
    assert.throws(() => p.publish(release.id, { revision: 1 }, true), /已改变/);
    p.publish(release.id, { revision: published.revision }, true); assert.equal(p.download(new Request(origin), file.id, file.name).status, 404);
  } finally { database.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('popup targeting, version gating, expiry and withdrawal are enforced by the server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmcl-popup-test-')), db = new PlatformDatabase(join(dir, 'db.sqlite'));
  try { const p = new Publishing(db.db, join(dir, 'files'), origin); const popup = p.savePopup({ title: '验收公告', body: '本地测试内容', platform: 'darwin', min_version: '0.2.0', starts_at: Date.now() - 1000, ends_at: Date.now() + 3600000 }, { operator: 'owner' }); assert.equal(p.publicPopups(new URLSearchParams({ platform: 'darwin', version: '1.0.0' })).data.length, 0); const published = p.popupAction(popup.id, { revision: 1 }); assert.equal(p.publicPopups(new URLSearchParams({ platform: 'darwin', version: '1.0.0' })).data.length, 1); assert.equal(p.publicPopups(new URLSearchParams({ platform: 'win32', version: '1.0.0' })).data.length, 0); assert.equal(p.publicPopups(new URLSearchParams({ platform: 'darwin', version: '0.1.0' })).data.length, 0); p.popupAction(popup.id, { revision: published.revision }, true); assert.equal(p.publicPopups(new URLSearchParams({ platform: 'darwin', version: '1.0.0' })).data.length, 0); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('fixed password uses salted scrypt hashes and retains secure sessions', async () => {
 const password = 'test-only-strong-password'; const hash = await hashAdminPassword(password);
 assert.notEqual(hash, await hashAdminPassword(password));
 assert.equal(hash.includes(password), false);
 assert.equal(await verifyAdminPassword('wrong', hash), false);
 assert.equal(await verifyAdminPassword(password, 'invalid'), false);
 const f = await fixture(true, hash);
 try {
  assert.equal((await (await f.request('/api/auth-mode')).json()).mode, 'password');
  assert.equal((await f.request('/api/login', {method:'POST', body:{password:'wrong'}})).status,401);
  const r=await f.request('/api/login', {method:'POST',body:{password}}); assert.equal(r.status,200);
  assert.equal((await f.request('/api/session',{cookie:r.headers.get('Set-Cookie').split(';')[0]})).status,200);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get().n,1);
 } finally {f.close();}
});
