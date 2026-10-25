import type { EnvironmentManifest, EnvironmentDifference } from './instanceCare'
const loaderKeys = new Set(['forge', 'neoForged', 'fabricLoader', 'quiltLoader', 'optifine', 'labyMod'])
export function parseEnvironment(value: unknown): EnvironmentManifest {
  if (!value || typeof value !== 'object') throw new Error('环境清单无效。')
  const v = value as EnvironmentManifest
  if (v.schema !== 1 || typeof v.minecraft !== 'string' || v.minecraft.length > 40 || !v.loaders || typeof v.loaders !== 'object' || Array.isArray(v.loaders) || !Array.isArray(v.mods) || v.mods.length > 2000) throw new Error('环境清单无效。')
  const loaders: Record<string, string> = {}
  for (const [key, version] of Object.entries(v.loaders)) { if (!loaderKeys.has(key) || typeof version !== 'string' || version.length > 80) throw new Error('加载器清单无效。'); loaders[key] = version }
  const names = new Set<string>()
  const mods = v.mods.map(m => {
    if (typeof m.name !== 'string' || !m.name || m.name.length > 200 || m.name.includes('/') || m.name.includes('\\') || !/^[a-f0-9]{64}$/.test(m.hash) || !Number.isSafeInteger(m.size) || m.size < 0 || names.has(m.name)) throw new Error('模组清单无效。')
    names.add(m.name); return { name: m.name, hash: m.hash, size: m.size }
  })
  return { schema: 1, minecraft: v.minecraft, loaders, mods }
}
export function compareEnvironments(local: EnvironmentManifest, remote: EnvironmentManifest): EnvironmentDifference[] {
  local = parseEnvironment(local); remote = parseEnvironment(remote)
  const result: EnvironmentDifference[] = []
  if (local.minecraft !== remote.minecraft) result.push({ kind: 'game', name: 'Minecraft', local: local.minecraft, remote: remote.minecraft })
  for (const key of new Set([...Object.keys(local.loaders), ...Object.keys(remote.loaders)])) if ((local.loaders[key] || '') !== (remote.loaders[key] || '')) result.push({ kind: 'loader', name: key, local: local.loaders[key] || '未安装', remote: remote.loaders[key] || '未安装' })
  const remaining = new Map(local.mods.map(m => [m.name, m]))
  for (const mod of remote.mods) {
    const own = remaining.get(mod.name)
    if (own) { if (own.hash !== mod.hash) result.push({kind:'changed',name:mod.name,local:own.hash.slice(0,12),remote:mod.hash.slice(0,12)}); remaining.delete(mod.name); continue }
    const same = [...remaining.values()].find(m => m.hash === mod.hash)
    if (same) remaining.delete(same.name)
    else result.push({kind:'missing',name:mod.name,local:'缺少',remote:'已安装'})
  }
  for (const mod of remaining.values()) result.push({kind:'extra',name:mod.name,local:'已安装',remote:'未安装'})
  return result
}
