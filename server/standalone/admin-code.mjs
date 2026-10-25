#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { issueAdminCode } from './admin-auth.mjs';

const args = process.argv.slice(2);
const value = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const path = value('--database', process.env.TORA_DATABASE || '/var/lib/tora-platform/platform.sqlite3');
if (!existsSync(path)) throw new Error('Platform database does not exist. Start the platform first.');
const db = new DatabaseSync(path, { timeout: 5000 });
try {
  db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL');
  const code = issueAdminCode(db, { operator: value('--operator', 'owner'), label: value('--label', '绪山同学') });
  process.stdout.write(code + '\n');
} finally { db.close(); }
