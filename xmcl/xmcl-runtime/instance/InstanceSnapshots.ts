import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, constants } from 'node:fs'
import { mkdir, readdir, lstat, realpath, readFile, writeFile, rename, rm, copyFile, stat, open } from 'node:fs/promises'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

const baseRoots = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'options.txt', 'optionsof.txt', 'instance.json']
const allowed = new Set([...baseRoots, 'saves'])
const locks = new Map<string, Promise<void>>()
const idPattern = /^snap_[a-f0-9-]{36}$/
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const exists = (p: string) => lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
async function atomicJson(path: string, value: unknown) { await writeFile(path + '.new', JSON.stringify(value), { mode: 0o600 }); await rename(path + '.new', path) }
async function checksum(path: string) { const h = createHash('sha256'), f = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); try { for await (const b of f.createReadStream()) h.update(b); return h.digest('hex') } finally { await f.close() } }

export interface SnapshotInfo { id: string; created: number; label: string; automatic: boolean; includesSaves: boolean; files: number; bytes: number; warnings: string[]; deleted?: boolean }
interface Manifest extends Omit<SnapshotInfo, 'files'> { schema: 1; instance: string; roots: string[]; dirs: string[]; files: { path: string; hash: string; size: number }[] }

/** Local content-addressed copies. Restores never follow links and always create a safety snapshot. */
export class InstanceSnapshots {
  constructor(readonly directory: string, private readonly quota = 5 * 1024 ** 3) {}
  private async locked<T>(instance: string, operation: (path: string) => Promise<T>, recover = false) {
    const path = await realpath(instance), key = resolve(this.directory)
    const previous = locks.get(key) || Promise.resolve(); let unlock!: () => void
    const current = new Promise<void>(r => { unlock = r }); locks.set(key, current)
    await previous
    try { await mkdir(this.directory, { recursive: true, mode: 0o700 }); if (recover) await this.recover(path); return await operation(path) }
    finally { unlock(); if (locks.get(key) === current) locks.delete(key) }
  }
  private folder(instance: string) { return join(this.directory, digest(instance)) }
  private blob(hash: string) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('快照内容索引无效。'); return join(this.directory, 'objects', hash) }
  private info(m: Manifest): SnapshotInfo { return { ...m, files: m.files.length } }
  private async manifests(instance: string, trash = false) {
    const folder = this.folder(instance), result: Manifest[] = []
    for (const name of await readdir(folder).catch(e => { if (e.code === 'ENOENT') return []; throw e })) {
      if (!(trash ? /^snap_[a-f0-9-]{36}\.trashed$/ : /^snap_[a-f0-9-]{36}\.json$/).test(name)) continue
      try { const m = await this.load(instance, name.slice(0, trash ? -8 : -5), trash); result.push(m) } catch { /* damaged metadata is never restored */ }
    }
    return result.sort((a, b) => b.created - a.created)
  }
  list(instance: string, trash = false) { return this.locked(instance, async path => (await this.manifests(path, trash)).map(m => ({...this.info(m),deleted:trash}))) }
  create(instance: string, label = '手动快照', includeSaves = false, automatic = false) {
    return this.locked(instance, async path => {
      if (await exists(join(this.folder(path), 'restore-journal.json'))) throw new Error('上次恢复被中断，请先退出游戏并重新执行一次恢复。')
      const latest = (await this.manifests(path))[0]
      if (automatic && latest?.automatic && Date.now() - latest.created < 10000) return this.info(latest)
      return this.info(await this.capture(path, label, includeSaves, automatic))
    })
  }
  private async load(instance: string, id: string, trash = false): Promise<Manifest> {
    if (!idPattern.test(id)) throw new Error('快照编号无效。')
    const path = join(this.folder(instance), id + (trash ? '.trashed' : '.json'))
    if ((await lstat(path)).isSymbolicLink() || (await stat(path)).size > 8 * 1024 ** 2) throw new Error('快照元数据无效。')
    const m: Manifest = JSON.parse(await readFile(path, 'utf8'))
    if (m.schema !== 1 || m.id !== id || m.instance !== instance || !Array.isArray(m.roots) || !m.roots.length || new Set(m.roots).size !== m.roots.length || !Array.isArray(m.dirs) || m.dirs.length > 50000 || m.roots.some(p => !allowed.has(p)) || !Array.isArray(m.files) || m.files.length > 50000) throw new Error('快照元数据无效。')
    for (const p of m.dirs) if (typeof p !== 'string' || p.includes('\\') || p.split('/').some(x => !x || x === '.' || x === '..') || isAbsolute(p) || !m.roots.includes(p.split('/')[0])) throw new Error('快照目录无效。')
    for (const f of m.files) if (typeof f.path !== 'string' || f.path.includes('\\') || f.path.split('/').some(x => !x || x === '.' || x === '..') || isAbsolute(f.path) || !m.roots.includes(f.path.split('/')[0]) || !/^[a-f0-9]{64}$/.test(f.hash) || !Number.isSafeInteger(f.size) || f.size < 0) throw new Error('快照文件路径无效。')
    return m
  }
  private async capture(instance: string, label: string, includeSaves: boolean, automatic: boolean, roots = includeSaves ? [...baseRoots, 'saves'] : baseRoots, strict = false) {
    await mkdir(join(this.directory, 'objects'), { recursive: true, mode: 0o700 }); await mkdir(this.folder(instance), { recursive: true, mode: 0o700 })
    const m: Manifest = { schema: 1, id: 'snap_' + randomUUID(), instance, created: Date.now(), label: String(label).slice(0, 80), automatic, includesSaves: includeSaves, roots: [], dirs: [], files: [], bytes: 0, warnings: [] }
    let used = 0
    for (const name of await readdir(join(this.directory, 'objects'))) if (/^[a-f0-9]{64}$/.test(name)) used += (await stat(this.blob(name))).size
    const newObjects: string[] = []
    try {
      for (const root of roots) {
        const pendingDirs: string[] = []
        const pending: { path: string; stat: Awaited<ReturnType<typeof lstat>> }[] = []
        const walk = async (name: string, depth = 0): Promise<void> => {
          if (depth > 32 || m.files.length + pending.length + pendingDirs.length > 50000) throw new Error('快照文件数量或目录层级过多。')
          const s = await lstat(join(instance, name))
          if (s.isSymbolicLink()) throw new Error('linked_directory')
          if (s.isDirectory()) { pendingDirs.push(name); for (const entry of await readdir(join(instance, name))) await walk(name + '/' + entry, depth + 1) }
          else if (s.isFile()) pending.push({ path: name, stat: s })
          else throw new Error('unsupported_file')
        }
        if (await exists(join(instance, root))) {
          try { await walk(root) } catch (e) { if (!strict && e instanceof Error && e.message === 'linked_directory') { m.warnings.push(`${root} 含共享链接，已保留原目录并跳过备份。`); continue } throw new Error(`无法备份 ${root}：${e instanceof Error ? e.message : '读取失败'}`) }
        }
        m.roots.push(root); m.dirs.push(...pendingDirs)
        for (const f of pending) {
          const temporary = join(this.directory, 'objects', '.pending-' + randomUUID()), hash = createHash('sha256'); let size = 0
          try {
            const source = await open(join(instance, f.path), constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
            await pipeline(source.createReadStream(), new Transform({ transform(chunk, _, cb) { hash.update(chunk); size += chunk.length; cb(null, chunk) } }), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
            const after = await lstat(join(instance, f.path))
            if (size !== f.stat.size || after.mtimeMs !== f.stat.mtimeMs || after.ino !== f.stat.ino) throw new Error('文件在备份期间发生变化，请退出游戏后重试。')
            const sum = hash.digest('hex'), destination = this.blob(sum)
            if (!await exists(destination)) { if (used + size > this.quota) throw new Error('本地快照空间达到 5 GB 上限，请先移除不需要的快照。'); await rename(temporary, destination); newObjects.push(destination); used += size }
            m.files.push({ path: f.path, hash: sum, size }); m.bytes += size
          } finally { await rm(temporary, { force: true }) }
        }
      }
      if (!m.roots.length) throw new Error('所选目录均为共享链接，无法创建独立快照。')
      await atomicJson(join(this.folder(instance), m.id + '.json'), m)
      return m
    } catch (e) { for (const object of newObjects) await rm(object, { force: true }); throw e }
  }
  restore(instance: string, id: string) {
    return this.locked(instance, async path => {
      const m = await this.load(path, id)
      const safety = await this.capture(path, '恢复前自动保护', m.includesSaves, false, m.roots, true)
      const stageName = '.tmcl-restore-' + randomUUID(), stage = join(path, stageName)
      await mkdir(join(stage, 'new'), { recursive: true, mode: 0o700 }); await mkdir(join(stage, 'old'), { mode: 0o700 })
      const changes: { root: string; existed: boolean }[] = []
      try {
        for (const dir of m.dirs) await mkdir(join(stage, 'new', dir), { recursive: true })
        for (const f of m.files) {
          const target = join(stage, 'new', f.path); await mkdir(dirname(target), { recursive: true })
          await copyFile(this.blob(f.hash), target)
          if ((await stat(target)).size !== f.size || await checksum(target) !== f.hash) throw new Error('快照完整性校验失败，实例未被替换。')
        }
        for (const root of m.roots) { const existed = await exists(join(path, root)); if (existed && (await lstat(join(path, root))).isSymbolicLink()) throw new Error('目标已改为共享链接，无法恢复。'); changes.push({ root, existed }) }
        await atomicJson(join(this.folder(path), 'restore-journal.json'), { stage: stageName, changes })
        for (const item of changes) { if (item.existed) await rename(join(path, item.root), join(stage, 'old', item.root)); if (await exists(join(stage, 'new', item.root))) await rename(join(stage, 'new', item.root), join(path, item.root)) }
        await rm(join(this.folder(path), 'restore-journal.json')); await rm(stage, { recursive: true, force: true })
        return { restored: this.info(m), safety: this.info(safety) }
      } catch (e) { await this.recover(path); throw e }
    }, true)
  }
  private async recover(instance: string) {
    const journalPath = join(this.folder(instance), 'restore-journal.json')
    if (!await exists(journalPath)) return
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    if (!/^\.tmcl-restore-[a-f0-9-]{36}$/.test(journal.stage) || !Array.isArray(journal.changes) || journal.changes.some((c: {root: string}) => !allowed.has(c.root))) throw new Error('恢复日志无效，请检查快照目录。')
    const stage = join(instance, journal.stage)
    for (const c of [...journal.changes].reverse()) {
      const old = join(stage, 'old', c.root), target = join(instance, c.root)
      if (await exists(old)) { if (await exists(target)) await rename(target, join(stage, 'new', c.root)); await rename(old, target) }
      else if (!c.existed && !await exists(join(stage, 'new', c.root)) && await exists(target)) await rename(target, join(stage, 'new', c.root))
    }
    await rm(journalPath)
    // Preserve interrupted/new files for recovery instead of deleting them.
  }
  remove(instance: string, id: string) {
    return this.locked(instance, async path => {
      await this.load(path, id); await rename(join(this.folder(path), id + '.json'), join(this.folder(path), id + '.trashed'))
      // Objects remain available: deleting a snapshot is reversible from local storage.
    })
  }
  untrash(instance:string,id:string){return this.locked(instance,async path=>{await this.load(path,id,true);if(await exists(join(this.folder(path),id+'.json')))throw new Error('快照编号已存在。');await rename(join(this.folder(path),id+'.trashed'),join(this.folder(path),id+'.json'))})}
  storage(instance:string){return this.locked(instance,async path=>{let used=0;for(const name of await readdir(join(this.directory,'objects')).catch(()=>[]))if(/^[a-f0-9]{64}$/.test(name))used+=(await stat(this.blob(name))).size;return{used,limit:this.quota,trashCount:(await this.manifests(path,true)).length}})}
  emptyTrash(instance:string){return this.locked(instance,async path=>{
    const own=this.folder(path),trash=(await readdir(own).catch(()=>[])).filter(name=>/^snap_[a-f0-9-]{36}\.trashed$/.test(name)),references=new Set<string>()
    for(const bucket of await readdir(this.directory)){
      if(!/^[a-f0-9]{64}$/.test(bucket))continue
      for(const name of await readdir(join(this.directory,bucket))){
        if(!/^snap_[a-f0-9-]{36}\.(?:json|trashed)$/.test(name)||join(this.directory,bucket)===own&&trash.includes(name))continue
        const manifest=JSON.parse(await readFile(join(this.directory,bucket,name),'utf8'))
        if(!Array.isArray(manifest.files))throw new Error('存在损坏的快照记录，停止清理。')
        for(const file of manifest.files){if(!/^[a-f0-9]{64}$/.test(file.hash))throw new Error('存在损坏的快照内容记录，停止清理。');references.add(file.hash)}
      }
    }
    for(const name of trash)await rm(join(own,name))
    for(const name of await readdir(join(this.directory,'objects')).catch(()=>[]))if(/^[a-f0-9]{64}$/.test(name)&&!references.has(name))await rm(this.blob(name))
    return{removed:trash.length}
  })}
}

interface MutationState { tail: Promise<void>; active: number; idle?: () => void }
const mutations = new Map<string, MutationState>()
async function mutationState(instance: string) { const key = await realpath(instance).catch(e => { if (e.code === 'ENOENT') return resolve(instance); throw e }); let state = mutations.get(key); if (!state) { state = { tail: Promise.resolve(), active: 0 }; mutations.set(key, state) }; return state }
async function gate<T>(state: MutationState, fn: () => Promise<T>) { const previous = state.tail; let release!: () => void; state.tail = new Promise<void>(r => { release = r }); await previous; try { return await fn() } finally { release() } }
export async function withInstanceMutation<T>(instance: string, fn: () => Promise<T>, prepare?: () => Promise<unknown>): Promise<T> {
  const state = await mutationState(instance)
  await gate(state, async () => { if (state.active === 0) await prepare?.(); state.active++ })
  try { return await fn() } finally { state.active--; if (state.active === 0) { state.idle?.(); state.idle = undefined } }
}
export async function withInstanceRestore<T>(instance: string, fn: () => Promise<T>): Promise<T> {
  const state = await mutationState(instance)
  return gate(state, async () => { if (state.active) await new Promise<void>(r => { state.idle = r }); return fn() })
}
export async function snapshotBeforeChange(appData: string, instance: string, label: string) {
  if (typeof appData !== 'string' || !appData || !await exists(join(instance, 'instance.json'))) return
  await new InstanceSnapshots(join(appData, 'snapshots')).create(instance, label, false, true)
}
