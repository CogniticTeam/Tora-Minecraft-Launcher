import { signReleaseFile } from './release-signing.mjs';
import { createReadStream, mkdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { open, rename, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import semver from 'semver';

export class PublishingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new PublishingError(status, message); };
const id = prefix => prefix + randomUUID().replaceAll('-', '');
function text(value, min, max) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /\x00/.test(value)) fail(422, '请检查输入内容及长度。'); return value.trim(); }
function version(value, optional = false) { if (optional && !value) return ''; if (typeof value !== 'string' || !semver.valid(value) || value.length > 64) fail(422, '请输入有效的语义版本号，例如 0.1.0。'); return semver.valid(value); }
const platforms = ['darwin', 'win32', 'linux'];
const kinds = { darwin: ['zip', 'dmg'], win32: ['exe', 'msi'], linux: ['AppImage', 'deb', 'rpm', 'tar.gz'] };

export class Publishing {
  constructor(db, directory, origin, signingKey) {
    this.db = db; this.directory = directory; this.origin = origin; this.signingKey = signingKey;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    db.exec(`CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,version TEXT UNIQUE NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,published_at INTEGER,operator TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS release_files(id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES releases(id),platform TEXT NOT NULL,arch TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,received INTEGER NOT NULL DEFAULT 0,sha256 TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'uploading',created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS release_file_variant ON release_files(release_id,platform,arch,kind) WHERE status!='removed';
      CREATE TABLE IF NOT EXISTS launcher_popups(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,button_label TEXT NOT NULL,url TEXT NOT NULL,platform TEXT NOT NULL,min_version TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,operator TEXT NOT NULL);`);
    this.uploads = new Set();
  }
  listReleases() { return this.db.prepare('SELECT * FROM releases ORDER BY created_at DESC LIMIT 100').all().map(r => ({ ...r, files: this.db.prepare("SELECT * FROM release_files WHERE release_id=? AND status!='removed' ORDER BY platform,arch,kind").all(r.id) })); }
  createRelease(data, session) {
    const v = version(data.version), title = text(data.title || 'TMCL ' + v, 1, 80), notes = text(data.notes, 1, 12000);
    if (!['stable', 'beta'].includes(data.channel)) fail(422, '请选择有效的更新通道。');
    if (data.channel === 'stable' && semver.prerelease(v)) fail(422, '预发行版本请选择测试通道。');
    if (this.db.prepare('SELECT 1 FROM releases WHERE version=?').get(v)) fail(409, '该版本已存在，请编辑草稿或使用新版本号。');
    const key = id('rel_');
    this.db.prepare('INSERT INTO releases(id,version,title,notes,channel,created_at,operator) VALUES(?,?,?,?,?,?,?)').run(key, v, title, notes, data.channel, Date.now(), session.operator);
    return this.listReleases().find(r => r.id === key);
  }
  release(key) { const row = this.db.prepare('SELECT * FROM releases WHERE id=?').get(key); if (!row) fail(404, '版本不存在。'); return row; }
  editRelease(key, data) {
    const row = this.release(key);
    if (row.status !== 'draft' || row.revision !== data.revision) fail(409, '只能编辑未改变的版本草稿。');
    this.db.prepare('UPDATE releases SET title=?,notes=?,revision=revision+1 WHERE id=?').run(text(data.title, 1, 80), text(data.notes, 1, 12000), key);
    return this.listReleases().find(r => r.id === key);
  }
  publish(key, data, withdraw = false) {
    const row = this.release(key);
    if (data.revision !== row.revision) fail(409, '版本信息已改变，请刷新后重试。');
    if (!withdraw && !this.db.prepare("SELECT 1 FROM release_files WHERE release_id=? AND status='ready'").get(key)) fail(422, '请先上传并校验至少一个安装包。');
    if (!withdraw && this.db.prepare("SELECT 1 FROM release_files WHERE release_id=? AND status NOT IN ('ready','removed')").get(key)) fail(422, '还有安装包未完成校验。');
    this.db.prepare('UPDATE releases SET status=?,published_at=?,revision=revision+1 WHERE id=? AND revision=?').run(withdraw ? 'withdrawn' : 'published', Date.now(), key, row.revision);
    return this.listReleases().find(r => r.id === key);
  }
  startUpload(key, data) {
    if (this.release(key).status !== 'draft') fail(409, '只有版本草稿可以上传安装包。');
    if (!platforms.includes(data.platform) || !['x64', 'arm64'].includes(data.arch) || !kinds[data.platform].includes(data.kind)) fail(422, '请选择受支持的平台、架构和安装包类型。');
    const name = text(data.name, 1, 120);
    if (/[\x00-\x1f\x7f/\\"<>]/.test(name) || !name.toLowerCase().endsWith('.' + data.kind.toLowerCase())) fail(422, '安装包文件名无效。');
    if (!Number.isSafeInteger(data.size) || data.size < 16 || data.size > 1073741824) fail(422, '单个安装包须在 16 字节至 1 GB 之间。');
    const used = this.db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM release_files').get().n;
    if (used + data.size > 8 * 1073741824) fail(507, '更新文件存储已达到 8 GB 上限，请由服务器维护人员归档旧文件。');
    if (this.db.prepare("SELECT 1 FROM release_files WHERE release_id=? AND platform=? AND arch=? AND kind=? AND status!='removed'").get(key, data.platform, data.arch, data.kind)) fail(409, '该平台安装包已存在，请继续上传或移除后重传。');
    const keyId = id('art_');
    const fd = openSync(join(this.directory, keyId + '.part'), 'wx', 0o600); closeSync(fd);
    this.db.prepare('INSERT INTO release_files(id,release_id,platform,arch,kind,name,size,created_at) VALUES(?,?,?,?,?,?,?,?)').run(keyId, key, data.platform, data.arch, data.kind, name, data.size, Date.now());
    return this.file(keyId);
  }
  file(key) { const row = this.db.prepare('SELECT * FROM release_files WHERE id=?').get(key); if (!row) fail(404, '上传记录不存在。'); return row; }
  removeFile(key) { const file = this.file(key); if (this.uploads.has(key) || this.release(file.release_id).status !== 'draft') fail(409, '只能移除未在上传的草稿文件。'); this.db.prepare("UPDATE release_files SET status='removed' WHERE id=?").run(key); return { removed: true }; }
  async chunk(key, offset, bytes) {
    if (this.uploads.has(key)) fail(409, '该文件正在处理另一个上传请求，请重试。');
    this.uploads.add(key);
    try {
      const file = this.file(key);
      if (this.release(file.release_id).status !== 'draft' || file.status !== 'uploading') fail(409, '该文件不再接受上传。');
      if (!Number.isSafeInteger(offset) || offset !== file.received) fail(409, '上传进度不一致，请刷新后继续。');
      if (!bytes.length || bytes.length > 524288 || file.received + bytes.length > file.size) fail(413, '上传分块大小无效。');
      const stream = await open(join(this.directory, key + '.part'), 'r+');
      try { let written = 0; while (written < bytes.length) written += (await stream.write(bytes, written, bytes.length - written, offset + written)).bytesWritten; await stream.sync(); } finally { await stream.close(); }
      this.db.prepare('UPDATE release_files SET received=received+? WHERE id=?').run(bytes.length, key);
      return this.file(key);
    } finally { this.uploads.delete(key); }
  }
  async finish(key) {
    if (this.uploads.has(key)) fail(409, '上传仍在处理中。');
    this.uploads.add(key);
    try {
      const row = this.file(key);
      if (row.status === 'ready') return row;
      if (this.release(row.release_id).status !== 'draft' || row.received !== row.size) fail(409, '文件尚未上传完整。');
      const part = join(this.directory, key + '.part'), path = existsSync(part) ? part : join(this.directory, key + '.blob');
      if ((await stat(path)).size !== row.size) fail(422, '文件实际大小与上传记录不一致。');
      const header = Buffer.alloc(8), fd = openSync(path, 'r');
      try { readSync(fd, header, 0, 8, 0); } finally { closeSync(fd); }
      const valid = row.kind === 'zip' ? header.subarray(0, 2).toString() === 'PK' : row.kind === 'exe' ? header.subarray(0, 2).toString() === 'MZ' : row.kind === 'AppImage' ? header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) : row.kind === 'deb' ? header.toString() === '!<arch>\n' : row.kind === 'rpm' ? header.subarray(0, 4).equals(Buffer.from([237, 171, 238, 219])) : row.kind === 'tar.gz' ? header[0] === 31 && header[1] === 139 : row.kind === 'msi' ? header.subarray(0, 4).equals(Buffer.from([208, 207, 17, 224])) : true;
      if (!valid) fail(422, '文件内容与声明的安装包类型不符。');
      if (row.kind === 'dmg') { if (row.size < 512) fail(422, 'DMG 文件格式无效。'); const end = Buffer.alloc(4), f = openSync(path, 'r'); try { readSync(f, end, 0, 4, row.size - 512); } finally { closeSync(f); } if (end.toString() !== 'koly') fail(422, 'DMG 文件格式无效。'); }
      const hash = createHash('sha256'); for await (const part of createReadStream(path)) hash.update(part);
      if (path === part) await rename(path, join(this.directory, key + '.blob'));
      this.db.prepare("UPDATE release_files SET status='ready',sha256=? WHERE id=?").run(hash.digest('hex'), key);
      return this.file(key);
    } finally { this.uploads.delete(key); }
  }
  savePopup(data, session) {
    const title = text(data.title, 1, 80), body = text(data.body, 1, 4000), label = text(data.button_label || '', 0, 24), url = text(data.url || '', 0, 2048), min = version(data.min_version, true);
    if (url) { let target; try { target = new URL(url); } catch { fail(422, '按钮链接无效。'); } if (target.protocol !== 'https:' || target.username || target.password) fail(422, '按钮链接必须是无凭据的 HTTPS 地址。'); }
    if (!['all', ...platforms].includes(data.platform)) fail(422, '请选择有效的平台范围。');
    if (!Number.isSafeInteger(data.starts_at) || !Number.isSafeInteger(data.ends_at) || data.starts_at < 0 || data.ends_at <= Math.max(Date.now(), data.starts_at)) fail(422, '公告结束时间必须晚于开始时间和当前时间。');
    if (data.id) {
      const row = this.db.prepare('SELECT * FROM launcher_popups WHERE id=?').get(data.id);
      if (!row || row.revision !== data.revision) fail(409, '公告已改变，请刷新后重试。');
      if (row.status === 'published') fail(409, '请先撤回公告，再编辑草稿。');
      this.db.prepare("UPDATE launcher_popups SET title=?,body=?,button_label=?,url=?,platform=?,min_version=?,starts_at=?,ends_at=?,status='draft',revision=revision+1 WHERE id=?").run(title, body, label, url, data.platform, min, data.starts_at, data.ends_at, data.id);
      return this.db.prepare('SELECT * FROM launcher_popups WHERE id=?').get(data.id);
    }
    const key = id('pop_');
    this.db.prepare('INSERT INTO launcher_popups(id,title,body,button_label,url,platform,min_version,starts_at,ends_at,created_at,operator) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(key, title, body, label, url, data.platform, min, data.starts_at, data.ends_at, Date.now(), session.operator);
    return this.db.prepare('SELECT * FROM launcher_popups WHERE id=?').get(key);
  }
  popupAction(key, data, withdraw = false) {
    const row = this.db.prepare('SELECT * FROM launcher_popups WHERE id=?').get(key);
    if (!row || row.revision !== data.revision) fail(409, '公告已改变，请刷新后重试。');
    if (!withdraw && row.ends_at <= Date.now()) fail(422, '公告已过期，请先修改有效期。');
    this.db.prepare('UPDATE launcher_popups SET status=?,revision=revision+1 WHERE id=?').run(withdraw ? 'withdrawn' : 'published', key);
    return this.db.prepare('SELECT * FROM launcher_popups WHERE id=?').get(key);
  }
  publicLatest(params) {
    const channel = params.get('channel') === 'beta' ? 'beta' : 'stable';
    const release = this.listReleases().filter(r => r.status === 'published' && (r.channel === 'stable' || channel === 'beta') && r.files.some(f => f.status === 'ready' && (!params.get('platform') || f.platform === params.get('platform')) && (!params.get('arch') || f.arch === params.get('arch')))).sort((a, b) => semver.rcompare(a.version, b.version))[0];
    const current = semver.valid(params.get('version') || '');
    if (!release) return { name: current || '0.1.0', body: '当前还没有公开发布的更新。', date: '', files: [], newUpdate: false, operation: 'manual' };
    return { name: release.version, title: release.title, body: release.notes, date: new Date(release.published_at).toISOString(), channel: release.channel, operation: this.signingKey ? 'autoupdater' : 'manual', automatic: !!this.signingKey, newUpdate: !!current && semver.gt(release.version, current), files: release.files.filter(f => f.status === 'ready' && (!params.get('platform') || f.platform === params.get('platform')) && (!params.get('arch') || f.arch === params.get('arch'))).map(f => signReleaseFile(this.signingKey,release.version,release.channel,{ name: f.name, url: this.origin + '/downloads/' + f.id + '/' + encodeURIComponent(f.name), platform: f.platform, arch: f.arch, kind: f.kind, size: f.size, sha256: f.sha256 })) };
  }
  publicPopups(params) {
    const now = Date.now(), v = semver.valid(params.get('version') || '');
    return { data: this.db.prepare("SELECT id,title,body,button_label,url,platform,min_version,revision,ends_at FROM launcher_popups WHERE status='published' AND starts_at<=? AND ends_at>? ORDER BY created_at DESC LIMIT 10").all(now, now).filter(p => (p.platform === 'all' || p.platform === params.get('platform')) && (!p.min_version || v && semver.gte(v, p.min_version))) };
  }
  download(request, key, name) {
    const row = this.db.prepare("SELECT f.* FROM release_files f JOIN releases r ON r.id=f.release_id WHERE f.id=? AND f.status='ready' AND r.status='published'").get(key);
    if (!row || name !== row.name) return new Response('Not found', { status: 404 });
    let start = 0, end = row.size - 1, status = 200;
    const range = request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= row.size || (match[2] && (Number(match[2]) < Number(match[1]) || Number(match[2]) >= row.size))) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + row.size } });
      start = Number(match[1]); if (match[2]) end = Number(match[2]); status = 206;
    }
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, 'Accept-Ranges': 'bytes', ETag: '"' + row.sha256 + '"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public,max-age=300', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${row.size}` } : {}) };
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(join(this.directory, key + '.blob'), { start, end })), { status, headers });
  }
}
