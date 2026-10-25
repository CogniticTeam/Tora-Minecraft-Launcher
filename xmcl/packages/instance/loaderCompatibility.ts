import type { PartialRuntimeVersions } from './instance'

export interface OptifineCompatibilityVersion {
  mcversion: string
  type: string
  patch: string
  /** Forge build explicitly listed by the OptiFine version catalog. */
  forge?: string
}
export const primaryLoaderKeys = ['forge', 'fabricLoader', 'quiltLoader', 'neoForged'] as const
export const primaryLoaderNames = { forge: 'Forge', fabricLoader: 'Fabric', quiltLoader: 'Quilt', neoForged: 'NeoForge' }
export function normalizeMinecraftVersion(version: string) {
  return version.endsWith('.0') ? version.slice(0, -2) : version
}
export function getOptifineForgeVersion(value?: string) {
  const match = value?.trim().match(/^(?:Forge\s*)?#?(\d+(?:\.\d+)*)$/i)
  return match?.[1]
}
export function isOptifineForgeCompatible(forge: string, metadata?: string) {
  const expected = getOptifineForgeVersion(metadata)
  if (!forge || !expected) return false
  // Older catalog entries specify only the Forge build number, prefixed by '#'.
  return expected.includes('.') ? forge === expected : forge.split('.').at(-1) === expected
}
export function findOptifineCompatibility(runtime: PartialRuntimeVersions, versions: readonly OptifineCompatibilityVersion[]) {
  let name = runtime.optifine ?? ''
  if (name.startsWith(runtime.minecraft)) name = name.slice(runtime.minecraft.length).replace(/^_/, '')
  return versions.find(v => normalizeMinecraftVersion(v.mcversion) === normalizeMinecraftVersion(runtime.minecraft) && `${v.type}_${v.patch}` === name)
}
export function getLoaderCompatibilityErrors(runtime: PartialRuntimeVersions, versions?: readonly OptifineCompatibilityVersion[], allowStandaloneClient = false): string[] {
  const errors: string[] = []
  const primary = primaryLoaderKeys.filter(key => runtime[key])
  if (primary.length > 1) errors.push(`${primary.map(key => primaryLoaderNames[key]).join('、')} 互不兼容，只能选择一个主加载器。`)
  if (runtime.labyMod && (primary.length || runtime.optifine || !allowStandaloneClient)) errors.push('LabyMod 暂无可校验的组合安装信息，不能与这些加载器一起安装。')
  if (runtime.optifine) {
    if (!runtime.forge || runtime.fabricLoader || runtime.quiltLoader || runtime.neoForged) errors.push('OptiFine 需要兼容的 Forge 前置；当前安装器不支持 Fabric/Quilt 桥接或 NeoForge 组合。')
    else if (versions) {
      const version = findOptifineCompatibility(runtime, versions)
      const expected = getOptifineForgeVersion(version?.forge)
      if (!version || !expected) errors.push('该 OptiFine 版本没有可验证的 Forge 兼容信息，请选择其他版本或刷新列表。')
      else if (!isOptifineForgeCompatible(runtime.forge, version.forge)) errors.push(`该 OptiFine 版本标注的 Forge 版本为 ${expected}，当前选择的是 ${runtime.forge}。`)
    }
  }
  return errors
}
