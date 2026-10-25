import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** One process owns the database. Every write is durable; namespaces isolate old DO records. */
export class PlatformDatabase {
  constructor(path) {
    mkdirSync(dirname(path), { recursive:true, mode:0o700 });
    this.db = new DatabaseSync(path, { timeout:5000 });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS kv(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER,PRIMARY KEY(namespace,key));
      CREATE TABLE IF NOT EXISTS alarms(namespace TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  storage(namespace, alarm) {
    const db=this.db;
    return {
      async get(key) {
        const row=db.prepare('SELECT value,expires FROM kv WHERE namespace=? AND key=?').get(namespace,key);
        if(!row || row.expires && row.expires<=Date.now())return undefined;
        return JSON.parse(row.value);
      },
      async put(key,value) { db.prepare('INSERT INTO kv(namespace,key,value) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,expires=NULL').run(namespace,key,JSON.stringify(value)); },
      async delete(key) { return db.prepare('DELETE FROM kv WHERE namespace=? AND key=?').run(namespace,key).changes>0; },
      async list() { return new Map(db.prepare('SELECT key,value FROM kv WHERE namespace=?').all(namespace).map(r=>[r.key,JSON.parse(r.value)])); },
      async deleteAll() { db.prepare('DELETE FROM kv WHERE namespace=?').run(namespace); },
      async setAlarm(at) { db.prepare('INSERT INTO alarms(namespace,at) VALUES(?,?) ON CONFLICT(namespace) DO UPDATE SET at=excluded.at').run(namespace,at); alarm?.(at); },
      async deleteAlarm() { db.prepare('DELETE FROM alarms WHERE namespace=?').run(namespace); },
    };
  }
  cache() {
    const db=this.db;
    return {
      async get(key,type) { const r=db.prepare('SELECT value,expires FROM kv WHERE namespace=\'cache\' AND key=?').get(key);if(!r || r.expires && r.expires<=Date.now())return null;return type==='json'?JSON.parse(r.value):r.value; },
      async put(key,value,options={}) { db.prepare('INSERT INTO kv(namespace,key,value,expires) VALUES(\'cache\',?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,expires=excluded.expires').run(key,String(value),options.expirationTtl?Date.now()+options.expirationTtl*1000:null); },
      async delete(key) { db.prepare('DELETE FROM kv WHERE namespace=\'cache\' AND key=?').run(key); },
    };
  }
  importSnapshot(snapshot) {
    if(this.db.prepare('SELECT value FROM metadata WHERE key=\'imported\'').get())throw new Error('migration_already_imported');
    if(snapshot.version!==1||!Array.isArray(snapshot.accounts))throw new Error('invalid_migration_snapshot');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert=this.db.prepare('INSERT INTO kv(namespace,key,value,expires) VALUES(?,?,?,?)');
      for(const [key,value] of snapshot.accounts) {
        if(key.startsWith('migration:'))continue;
        insert.run('accounts-v1',key,JSON.stringify(value),null);
      }
      for(const item of snapshot.cache||[])insert.run('cache',item.key,item.value,item.expiration?item.expiration*1000:null);
      for(const item of snapshot.replays||[])insert.run(item.namespace,'entries',JSON.stringify(item.entries),null);
      for(const item of snapshot.rooms||[]){for(const [key,value] of item.entries)insert.run('room:'+item.name,key,JSON.stringify(value),null);if(Number.isFinite(item.alarmAt))this.db.prepare('INSERT INTO alarms(namespace,at) VALUES(?,?)').run('room:'+item.name,item.alarmAt);}
      this.db.prepare('INSERT INTO metadata(key,value) VALUES(\'imported\',?)').run(JSON.stringify({at:new Date().toISOString(),source:snapshot.createdAt}));
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  sweep() { this.db.prepare('DELETE FROM kv WHERE expires IS NOT NULL AND expires<=?').run(Date.now()); }
  close() { this.db.close(); }
}

export class MemoryRateLimiter {
  constructor(limit, period=60000) {this.limitCount=limit;this.period=period;this.entries=new Map();}
  async limit({key}) {
    const now=Date.now();let entry=this.entries.get(key);
    if((!entry||entry.until<=now)&&this.entries.size>=20000){for(const[k,v]of this.entries)if(v.until<=now)this.entries.delete(k);if(this.entries.size>=20000)return{success:false}}
    if(!entry||entry.until<=now){entry={count:0,until:now+this.period};this.entries.set(key,entry)}
    if(this.entries.size>10000)for(const [k,v]of this.entries)if(v.until<=now)this.entries.delete(k);
    return {success:++entry.count<=this.limitCount};
  }
}
