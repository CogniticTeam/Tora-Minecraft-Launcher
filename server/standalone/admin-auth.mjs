import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';

import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const passwordOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Error('invalid_admin_password');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 32, passwordOptions);
  return `scrypt-v1$${salt}$${hash.toString('hex')}`;
}
export async function verifyAdminPassword(password, encoded) {
  if (typeof password !== 'string' || !password.length || password.length > 256 || typeof encoded !== 'string') return false;
  const parts = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!parts) return false;
  const actual = await scrypt(password, parts[1], 32, passwordOptions);
  return timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}
export function createAdminSession(db, { operator = 'owner', label = '绪山同学' } = {}, now = Date.now()) {
  const token = secret(), csrf = secret();
  db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,?,?)').run(digest(token), operator, label, csrf, now, now, now + absoluteLifetime);
  db.prepare('INSERT INTO admin_events(operator,event,created) VALUES(?,?,?)').run(operator, 'login', now);
  return { token, csrf, operator, label, expires: now + absoluteLifetime };
}

const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const absoluteLifetime = 8 * 3600000;
const idleLifetime = 30 * 60000;

export function initAdminAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS admin_codes(hash TEXT PRIMARY KEY,operator TEXT NOT NULL,label TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions(hash TEXT PRIMARY KEY,operator TEXT NOT NULL,label TEXT NOT NULL,csrf TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_events(id INTEGER PRIMARY KEY,operator TEXT NOT NULL,event TEXT NOT NULL,created INTEGER NOT NULL);`);
}

/** Run under the platform service user through SSH; never persist or log the plaintext code. */
export function issueAdminCode(db, { operator = 'owner', label = 'TMCL 管理员' } = {}, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(operator) || typeof label !== 'string' || !label.trim() || label.length > 24 || /[\x00-\x1f\x7f<>]/.test(label)) throw new Error('invalid_admin_operator');
  initAdminAuth(db);
  const code = randomBytes(9).toString('hex').toUpperCase();
  db.prepare('DELETE FROM admin_codes WHERE operator=? OR expires<=?').run(operator, now);
  db.prepare('INSERT INTO admin_codes VALUES(?,?,?,?)').run(digest(code), operator, label.trim(), now + 10 * 60000);
  return 'TMCL-' + code.match(/.{6}/g).join('-');
}

export function loginAdmin(db, code, now = Date.now()) {
  if (typeof code !== 'string' || code.length > 64) return null;
  const normalized = code.replace(/^TMCL-/i, '').replace(/[-\s]/g, '').toUpperCase();
  if (!/^[A-F0-9]{18}$/.test(normalized)) return null;
  const token = secret(), csrf = secret();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('DELETE FROM admin_codes WHERE hash=? AND expires>? RETURNING operator,label').get(digest(normalized), now);
    if (!row) { db.exec('ROLLBACK'); return null; }
    db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,?,?)').run(digest(token), row.operator, row.label, csrf, now, now, now + absoluteLifetime);
    db.prepare('INSERT INTO admin_events(operator,event,created) VALUES(?,?,?)').run(row.operator, 'login', now);
    db.exec('COMMIT');
    return { token, csrf, operator: row.operator, label: row.label, expires: now + absoluteLifetime };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function getAdminSession(db, token, now = Date.now()) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = digest(token);
  const row = db.prepare('SELECT * FROM admin_sessions WHERE hash=? AND expires>? AND last_seen>?').get(hash, now, now - idleLifetime);
  if (!row) return null;
  if (now - row.last_seen > 60000) db.prepare('UPDATE admin_sessions SET last_seen=? WHERE hash=?').run(now, hash);
  return row;
}

export function validCsrf(actual, expected) {
  return typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function logoutAdmin(db, session) {
  db.prepare('DELETE FROM admin_sessions WHERE hash=?').run(session.hash);
  db.prepare('INSERT INTO admin_events(operator,event,created) VALUES(?,?,?)').run(session.operator, 'logout', Date.now());
}

export function sweepAdmin(db, now = Date.now()) {
  db.prepare('DELETE FROM admin_codes WHERE expires<=?').run(now);
  db.prepare('DELETE FROM admin_sessions WHERE expires<=? OR last_seen<=?').run(now, now - idleLifetime);
  db.prepare('DELETE FROM admin_events WHERE created<?').run(now - 90 * 86400000);
}
