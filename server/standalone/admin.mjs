import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { initAdminAuth, loginAdmin, verifyAdminPassword, createAdminSession, getAdminSession, validCsrf, logoutAdmin, sweepAdmin } from './admin-auth.mjs';
import { MemoryRateLimiter } from './storage.mjs';
import { PublishingError } from './publishing.mjs';

const assets = new Map([['/admin/', ['index.html', 'text/html; charset=utf-8']], ['/admin/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/admin/style.css', ['style.css', 'text/css; charset=utf-8']], ['/admin/logo.png', ['logo.png', 'image/png']], ['/downloads', ['downloads.html', 'text/html; charset=utf-8']], ['/downloads/app.js', ['downloads.js', 'text/javascript; charset=utf-8']]]);
const security = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
class AdminError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const failure = (status, code, message) => { throw new AdminError(status, code, message); };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...security, ...extra } });

export class AdminConsole {
  constructor({ database, origin, env, communityOrigin, assetsPath, publishing, fetcher = fetch }) {
    this.db = database.db; this.origin = origin; this.env = env;
    this.communityOrigin = communityOrigin || 'http://127.0.0.1:8765';
    this.assetsPath = assetsPath || fileURLToPath(new URL('./admin/', import.meta.url));
    this.fetcher = fetcher; this.started = Date.now();
    this.publishing = publishing;
    this.secure = new URL(origin).protocol === 'https:';
    if (!this.secure && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('admin_requires_https');
    this.cookieName = this.secure ? '__Host-tmcl-admin' : 'tmcl-admin-dev';
    this.passwordChecks = 0;
    this.loginLimits = new MemoryRateLimiter(8, 10 * 60000);
    this.requestLimits = new MemoryRateLimiter(180);
    this.writeLimits = new MemoryRateLimiter(30);
    this.uploadLimits = new MemoryRateLimiter(600);
    initAdminAuth(this.db);
  }
  sweep() { sweepAdmin(this.db); }
  cookie(token = '') {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 8 * 3600 : 0}${this.secure ? '; Secure' : ''}`;
  }
  session(request) {
    const cookies = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(this.cookieName + '='));
    return cookies.length === 1 ? getAdminSession(this.db, cookies[0].slice(this.cookieName.length + 1)) : null;
  }
  async body(request) {
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') failure(415, 'json_required', '请使用 JSON 提交。');
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > 65536) failure(413, 'body_too_large', '请求内容过大。');
    try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { failure(422, 'invalid_json', '提交内容格式无效。'); }
  }
  async community(path, session, method = 'GET', body) {
    const url = new URL('/internal/admin' + path, this.communityOrigin);
    let response;
    try {
      response = await this.fetcher(url, { method, signal: AbortSignal.timeout(method === 'POST' && ['/messages', '/check-content'].includes(path) ? 30000 : 5000), redirect: 'error', headers: { Authorization: 'Bearer ' + this.env.COMMUNITY_ADMIN_TOKEN, 'X-Admin-Operator': session.operator, 'X-Admin-Label': encodeURIComponent(session.label), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const reader = response.body?.getReader(); let size = 0; const chunks = [];
      if (reader) { try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 524288) failure(502, 'response_too_large', '管理数据过大，请缩小范围。'); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); } }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok) failure(response.status, payload.error?.code || 'community_error', payload.error?.message || '社区暂时无法完成请求。');
      return payload;
    } catch (error) {
      if (error instanceof AdminError) throw error;
      failure(503, 'community_unavailable', '社区服务暂时不可用，请稍后重试。');
    }
  }
  async services(session) {
    let community;
    try { const r = await this.fetcher(new URL('/health', this.communityOrigin), { signal: AbortSignal.timeout(3000), headers: { Authorization: 'Bearer ' + this.env.COMMUNITY_GATEWAY_TOKEN } }); community = r.ok && (await r.json()).status === 'ok'; } catch { community = false; }
    this.db.prepare('SELECT 1').get();
    const rooms = this.db.prepare("SELECT value FROM kv WHERE namespace LIKE 'room:%' AND key='room'").all();
    const activeRooms = rooms.reduce((n, row) => { try { const room = JSON.parse(row.value); return n + Number(room.status !== 'closed' && room.expiresAt > Date.now()); } catch { return n; } }, 0);
    return { data: { checked_at: Date.now(), uptime_seconds: Math.floor((Date.now() - this.started) / 1000), memory_mb: Math.round(process.memoryUsage().rss / 1048576), node_version: process.version, active_rooms: activeRooms, services: [
      { id: 'platform', name: '账号与平台 API', status: 'ok', detail: '进程响应正常 · SQLite 可读' },
      { id: 'community', name: '社区 API', status: community ? 'ok' : 'error', detail: community ? '本机健康检查通过' : '健康检查暂未通过' },
      { id: 'signaling', name: '联机信令', status: 'ok', detail: `协议已启用 · ${activeRooms} 个有效房间` },
      ...(this.terracottaStats ? [{ id: 'terracotta', name: '陶瓦联机中继', status: 'ok', detail: `TMCL 备用通道已启用 · ${this.terracottaStats().rooms} 个房间 · ${this.terracottaStats().connections} 条连接` }] : []),
      { id: 'stun', name: 'STUN 地址发现', status: 'unknown', detail: 'UDP 3478 · 此页面不执行公网 UDP 探测' }
    ] } };
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.origin !== this.origin) return json({ error: { code: 'not_found', message: '接口不存在。' } }, 404);
      if (url.pathname === '/admin') return new Response(null, { status: 302, headers: { ...security, Location: '/admin/' } });
      const file = assets.get(url.pathname);
      if (file && ['GET', 'HEAD'].includes(request.method)) {
        try { const content = await readFile(join(this.assetsPath, file[0])); return new Response(request.method === 'HEAD' ? null : content, { headers: { ...security, 'Content-Type': file[1] } }); }
        catch { failure(503, 'assets_unavailable', '管理端资源尚未部署。'); }
      }
      if (!url.pathname.startsWith('/admin/api/')) failure(404, 'not_found', '页面不存在。');
      if (!this.env.COMMUNITY_ADMIN_TOKEN || this.env.COMMUNITY_ADMIN_TOKEN.length < 32) failure(503, 'admin_not_configured', '管理端尚未启用，请按部署文档配置管理连接。');
      if (url.search.length > 2048) failure(422, 'invalid_query', '查询条件过长。');
      const write = !['GET', 'HEAD'].includes(request.method);
      if (write && (request.headers.get('Origin') !== this.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')) failure(403, 'invalid_origin', '请求来源验证失败，请在管理端页面重试。');
      const path = url.pathname.slice('/admin/api'.length);
      if (path === '/auth-mode' && request.method === 'GET') return json({ mode: this.env.TORA_ADMIN_PASSWORD_HASH ? 'password' : 'code' });
      if (path === '/login' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!(await this.loginLimits.limit({ key: ip })).success) failure(429, 'rate_limited', '尝试次数过多，请稍后再试。');
        const body = await this.body(request);
        let session;
        if (Object.hasOwn(body, 'password')) {
          if (this.passwordChecks >= 2) failure(429, 'login_busy', '登录较繁忙，请稍后重试。');
          this.passwordChecks++;
          try { if (await verifyAdminPassword(body.password, this.env.TORA_ADMIN_PASSWORD_HASH)) session = createAdminSession(this.db); }
          finally { this.passwordChecks--; }
          if (!session) failure(401, 'invalid_password', '管理密码不正确。');
        } else {
          session = loginAdmin(this.db, body.code);
          if (!session) failure(401, 'invalid_login_code', '登录码无效、已使用或已过期。');
        }
        return json({ authenticated: true, label: session.label, csrf: session.csrf, expires: session.expires, environment: this.env.TORA_ADMIN_STAGING === '1' ? 'staging' : 'production' }, 200, { 'Set-Cookie': this.cookie(session.token) });
      }
      const session = this.session(request);
      if (!session) failure(401, 'authentication_required', '请先登录管理端。');
      const chunkUpload = request.method === 'PUT' && /^\/artifacts\/art_[a-f0-9]{32}$/.test(path);
      if (!(await (chunkUpload ? this.uploadLimits : this.requestLimits).limit({ key: session.hash })).success) failure(429, 'rate_limited', '请求较频繁，请稍后重试。');
      if (write && !validCsrf(request.headers.get('X-CSRF-Token'), session.csrf)) failure(403, 'invalid_csrf', '页面验证已失效，请刷新后重试。');
      if (write && !chunkUpload && !(await this.writeLimits.limit({ key: session.hash })).success) failure(429, 'rate_limited', '操作较频繁，请稍后重试。');
      if (path === '/session' && request.method === 'GET') return json({ authenticated: true, label: session.label, csrf: session.csrf, expires: session.expires, environment: this.env.TORA_ADMIN_STAGING === '1' ? 'staging' : 'production' });
      if (path === '/logout' && request.method === 'POST') { logoutAdmin(this.db, session); return json({ authenticated: false }, 200, { 'Set-Cookie': this.cookie() }); }
      if (path === '/services' && request.method === 'GET') return json(await this.services(session));
      if (path === '/releases' && request.method === 'GET') return json({ data: this.publishing.listReleases() });
      if (path === '/releases' && request.method === 'POST') return json({ data: this.publishing.createRelease(await this.body(request), session) }, 201);
      const releaseAction = /^\/releases\/(rel_[a-f0-9]{32})\/(publish|withdraw|files|save)$/.exec(path);
      if (releaseAction && request.method === 'POST') {
        const body = await this.body(request), key = releaseAction[1], action = releaseAction[2];
        const data = action === 'files' ? this.publishing.startUpload(key, body) : action === 'save' ? this.publishing.editRelease(key, body) : this.publishing.publish(key, body, action === 'withdraw');
        this.db.prepare('INSERT INTO admin_events(operator,event,created) VALUES(?,?,?)').run(session.operator, 'release_' + action + ':' + key, Date.now());
        return json({ data });
      }
      const upload = /^\/artifacts\/(art_[a-f0-9]{32})(?:\/(finish|remove))?$/.exec(path);
      if (upload) {
        if (request.method === 'GET' && !upload[2]) return json({ data: this.publishing.file(upload[1]) });
        if (request.method === 'PUT' && !upload[2]) {
          if (request.headers.get('Content-Type') !== 'application/octet-stream') failure(415, 'binary_required', '上传分块需使用二进制内容。');
          return json({ data: await this.publishing.chunk(upload[1], Number(url.searchParams.get('offset')), Buffer.from(await request.arrayBuffer())) });
        }
        if (request.method === 'POST' && upload[2]) return json({ data: upload[2] === 'finish' ? await this.publishing.finish(upload[1]) : this.publishing.removeFile(upload[1]) });
      }
      if (path === '/popups' && request.method === 'GET') return json({ data: this.db.prepare('SELECT * FROM launcher_popups ORDER BY created_at DESC LIMIT 100').all() });
      if (path === '/popups' && request.method === 'POST') return json({ data: this.publishing.savePopup(await this.body(request), session) });
      const popupAction = /^\/popups\/(pop_[a-f0-9]{32})\/(publish|withdraw)$/.exec(path);
      if (popupAction && request.method === 'POST') {
        const data = await this.body(request);
        if (popupAction[2] === 'publish') {
          const popup = this.db.prepare('SELECT * FROM launcher_popups WHERE id=?').get(popupAction[1]);
          if (!popup || popup.revision !== data.revision) failure(409, 'revision_conflict', '公告已改变，请刷新后重试。');
          await this.community('/check-content', session, 'POST', { title: popup.title, body: popup.body, url: popup.url });
        }
        return json({ data: this.publishing.popupAction(popupAction[1], data, popupAction[2] === 'withdraw') });
      }
      if (request.method === 'GET' && ['/overview', '/posts', '/users', '/reports', '/audit', '/boards', '/messages', '/reviews'].includes(path)) return json(await this.community(path + url.search, session));
      if (request.method === 'GET' && /^\/posts\/ps_[a-f0-9]{32}$/.test(path)) return json(await this.community(path + url.search, session));
      if (['/actions', '/boards', '/messages', '/announcements'].includes(path) && request.method === 'POST') return json(await this.community(path, session, 'POST', await this.body(request)));
      failure(404, 'not_found', '管理接口不存在。');
    } catch (error) {
      if (error instanceof PublishingError) return json({ error: { code: 'publishing_error', message: error.message } }, error.status);
      if (error instanceof AdminError) return json({ error: { code: error.code, message: error.message } }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
      return json({ error: { code: 'admin_service_error', message: '管理端暂时无法完成请求，请稍后重试。' } }, 500);
    }
  }
}
