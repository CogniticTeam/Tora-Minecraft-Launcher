import { ToraUpdater } from './ToraUpdater'
import { ipcMain, net, type WebContents } from 'electron'
import { realpath, readdir, lstat, readFile, mkdir, rename, rm, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { freemem, totalmem } from 'node:os'
import type { LauncherApp } from '@xmcl/runtime/app'
import { InstanceService } from '@xmcl/runtime/instance'
import { LaunchService } from '@xmcl/runtime/launch'
import { InstanceSnapshots, withInstanceRestore } from '@xmcl/runtime/instance/InstanceSnapshots'
import { diagnoseLaunchLog } from '../../xmcl-keystone-ui/src/util/instanceDiagnosis'
import type { CareIssue, CommunityResource, EnvironmentManifest } from '../instanceCare'

const projectPattern = /^[a-zA-Z0-9_-]{1,100}$/
const hashes = new Map<string, { key: string; hash: string }>()
export class InstanceCareController {
  private owners = new Set<number>()
  readonly store: InstanceSnapshots
  constructor(private readonly launcher: LauncherApp) {
    this.store = new InstanceSnapshots(join(launcher.appDataPath, 'snapshots'))
    ipcMain.handle('tora:instance-care', async ({ sender }, action, path, data) => {
      if (!this.owners.has(sender.id)) throw new Error('instance_care_forbidden')
      if (action === 'update-preferences' || action === 'set-update-channel') { const updater = launcher.updater as ToraUpdater; return action === 'update-preferences' ? updater.preferences() : updater.setChannel(path) }
      if (action === 'resource') return this.resource(path, data?.minecraft, data?.loader)
      if (action === 'download-resource') return this.downloadResource(path, data)
      const { instance, service, canonical } = await this.instance(path)
      if (action === 'environment') return this.environment(canonical, instance.runtime)
      if (action === 'diagnose') return this.diagnose(canonical, instance)
      if (action === 'list') return this.store.list(canonical,!!data)
      if (action === 'trash') return this.store.remove(canonical,data)
      if (action === 'untrash') return this.store.untrash(canonical,data)
      if (action === 'empty-trash') return this.store.emptyTrash(canonical)
      if (action === 'snapshot-storage') return this.store.storage(canonical)
      if (action === 'snapshot' || action === 'restore') {
        const launch = await launcher.registry.get(LaunchService)
        if ((await launch.getGameProcesses()).some(p => p.options.gameDirectory === canonical)) throw new Error('请先退出这个实例的游戏，再创建或恢复快照。')
        if (action === 'snapshot') return withInstanceRestore(canonical, () => this.store.create(canonical, data?.label, !!data?.saves))
        const result = await withInstanceRestore(canonical, () => this.store.restore(canonical, data))
        const restored = JSON.parse(await readFile(join(canonical, 'instance.json'), 'utf8'))
        await service.editInstance({ ...restored, name: instance.name, icon: instance.icon, instancePath: path })
        return result
      }
      throw new Error('instance_care_invalid_action')
    })
  }
  attach(sender: WebContents) { this.owners.add(sender.id) }
  detach(id: number) { this.owners.delete(id) }
  async manifest(path?:string){if(!path)return undefined;const {canonical,instance}=await this.instance(path);return this.environment(canonical,instance.runtime)}
  private async instance(path: unknown) {
    if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('请先选择一个实例。')
    const service = await this.launcher.registry.get(InstanceService); await service.initialize()
    const instance = service.state.all[path]
    if (!instance || instance.edition === 'bedrock') throw new Error('此功能需要已注册的 Minecraft Java 实例。')
    return { instance, service, canonical: await realpath(instance.path) }
  }
  async environment(path: string, runtime: Record<string, string>): Promise<EnvironmentManifest> {
    const mods: EnvironmentManifest['mods'] = []
    const root = join(path, 'mods')
    if (await lstat(root).then(s => s.isSymbolicLink(), () => false)) throw new Error('模组目录为共享链接，暂不生成环境清单。')
    const files = await readdir(root).catch(e => { if (e.code === 'ENOENT') return []; throw e })
    if (files.length > 2000) throw new Error('模组数量过多，请先整理实例。')
    for (const name of files.sort()) {
      if (!name.toLowerCase().endsWith('.jar')) continue
      const file = join(root, name), s = await lstat(file)
      if (!s.isFile() || s.isSymbolicLink()) continue
      const key = `${s.ino}:${s.mtimeMs}:${s.size}`, cached = hashes.get(file)
      let hash = cached?.key === key ? cached.hash : ''
      if (!hash) { const h = createHash('sha256'), f = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); try { for await (const b of f.createReadStream()) h.update(b) } finally { await f.close() }; hash = h.digest('hex'); hashes.set(file, { key, hash }); if (hashes.size > 10000) hashes.clear() }
      mods.push({ name: name.slice(0, 200), hash, size: s.size })
    }
    return { schema: 1, minecraft: runtime.minecraft || '', loaders: Object.fromEntries(Object.entries(runtime).filter(([k, v]) => k !== 'minecraft' && !!v)), mods }
  }
  private async diagnose(path: string, instance: {java?: string; maxMemory?: number}) {
    let log = '', logAvailable = false
    try { const f = await open(join(path, 'logs', 'latest.log'), constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); try { const size = (await f.stat()).size, bytes = Buffer.alloc(Math.min(size, 1024 ** 2)); await f.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length)); log = bytes.toString('utf8'); logAvailable = true } finally { await f.close() } } catch { /* first launch may have no log */ }
    const issues: CareIssue[] = diagnoseLaunchLog(log)
    if (instance.java && !await lstat(instance.java).then(s => s.isFile(), () => false)) issues.push({ id: 'java-path', title: '指定的 Java 路径不可用', detail: '选择的 Java 已移动或删除，请重新选择。', severity: 'error', action: 'java' })
    if (instance.maxMemory && instance.maxMemory * 1024 ** 2 > totalmem() * .8) issues.push({ id: 'allocation', title: '游戏内存分配偏高', detail: '当前分配超过系统总内存的 80%，建议为系统保留空间。', severity: 'warning', action: 'memory' })
    if (freemem() < 512 * 1024 ** 2) issues.push({ id: 'system-memory', title: '系统可用内存较少', detail: '请先关闭不用的应用，再尝试启动。', severity: 'warning', action: 'memory' })
    const names = await readdir(join(path, 'mods')).catch(() => [] as string[])
    if (names.some(n => /^optifine.*\.jar$/i.test(n)) && names.some(n => /^sodium.*\.jar$/i.test(n))) issues.push({ id: 'render-conflict', title: 'OptiFine 与 Sodium 可能冲突', detail: '请核对加载器要求，并停用其中一个渲染模组后测试。', severity: 'warning', action: 'mods' })
    return { issues, checked: Date.now(), logAvailable }
  }
  private async api(path: string) {
    const response = await net.fetch('https://api.modrinth.com/v2/' + path, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('无法读取 Modrinth 资源信息，请稍后重试。')
    return response.json()
  }
  private async resource(source: string, minecraft?: string, loader?: string): Promise<CommunityResource> {
    let project: string
    try { const url = new URL(source); if (url.protocol !== 'https:' || !['modrinth.com', 'www.modrinth.com'].includes(url.hostname) || url.username || url.password) throw new Error(); project = url.pathname.split('/')[2]; if (!projectPattern.test(project)) throw new Error() } catch { throw new Error('当前支持从 Modrinth 项目链接导入；其它来源请先查看原始页面。') }
    const info = await this.api('project/' + project)
    const query = new URLSearchParams()
    if (minecraft) query.set('game_versions', JSON.stringify([String(minecraft).slice(0, 40)]))
    if (info.project_type === 'mod' && loader && ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) query.set('loaders', JSON.stringify([loader]))
    const versions = await this.api(`project/${project}/version?${query}`)
    const version = versions.find((v: {version_type: string}) => v.version_type === 'release') || versions[0]
    const file = version?.files?.find((f: {primary: boolean}) => f.primary) || version?.files?.[0]
    if (!file || !/^[a-f0-9]{128}$/i.test(file.hashes?.sha512) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 512 * 1024 ** 2) throw new Error('没有可用的兼容资源文件，或文件超过 512 MB。')
    const url = new URL(file.url)
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.modrinth.com' || url.username || url.password) throw new Error('资源下载来源无效。')
    return { project: info.id, title: info.title, author: 'Modrinth 项目：' + info.slug, type: info.project_type, version: version.version_number, versionId: version.id, gameVersions: version.game_versions, loaders: version.loaders, filename: file.filename, size: file.size, sha512: file.hashes.sha512.toLowerCase(), url: url.href }
  }
  private async downloadResource(project: string, versionId: string) {
    if (!projectPattern.test(project) || !projectPattern.test(versionId)) throw new Error('资源编号无效。')
    const version = await this.api('version/' + versionId)
    if (version.project_id !== project) throw new Error('资源与项目不匹配。')
    const file = version.files?.find((f: {primary: boolean}) => f.primary) || version.files?.[0]
    if (!file || !/^[a-f0-9]{128}$/i.test(file.hashes?.sha512) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 512 * 1024 ** 2 || typeof file.filename !== 'string' || file.filename.length > 200 || file.filename.includes('/') || file.filename.includes('\\') || Array.from(file.filename as string).some(c => c.charCodeAt(0) < 32) || !/\.(?:mrpack|jar|zip)$/i.test(file.filename)) throw new Error('资源文件无效。')
    const url = new URL(file.url)
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.modrinth.com' || url.username || url.password) throw new Error('下载来源无效。')
    const dir = join(this.launcher.appDataPath, 'community-downloads', versionId); await mkdir(dir, { recursive: true, mode: 0o700 })
    const target = join(dir, file.filename), temp = target + '.part'
    const response = await net.fetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(120000) })
    if (!response.ok || !response.body) throw new Error('资源下载失败，请重试。')
    const hash = createHash('sha512'), handle = await open(temp, 'w', 0o600); let size = 0
    try { const reader = response.body.getReader(); try { while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > file.size) throw new Error('下载文件体积与发布信息不一致。'); hash.update(value); await handle.writeFile(value) } } finally { await reader.cancel() } }
    catch(e) { await handle.close(); await rm(temp, {force:true}); throw e }
    finally { await handle.close() }
    if (size !== file.size || hash.digest('hex') !== file.hashes.sha512.toLowerCase()) { await rm(temp, { force: true }); throw new Error('资源完整性校验失败，未进行安装。') }
    await rename(temp, target); return target
  }
}
