import { findOptifineCompatibility, isOptifineForgeCompatible, normalizeMinecraftVersion, type InstanceData, type OptifineCompatibilityVersion } from '@xmcl/instance'
import type { ForgeVersion } from '@xmcl/runtime-api'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'

interface Options {
  data: Pick<InstanceData, 'runtime' | 'version'>
  selectOptifine: (version: string) => void
  selectForge: (version: string) => void
  getOptifineVersions: () => Promise<readonly OptifineCompatibilityVersion[]>
  getForgeVersions: (minecraft: string) => Promise<readonly ForgeVersion[]>
}

export function useOptifineForgeSelection(options: Options) {
  const matching = ref(false)
  const result = shallowRef<{ kind: 'adjusted' | 'unavailable' | 'failed'; from: string; to?: string }>()
  let requestId = 0
  onScopeDispose(() => { requestId++; matching.value = false })
  watch(() => [options.data.runtime.minecraft, options.data.runtime.forge, options.data.runtime.optifine], () => {
    result.value = undefined
  }, { flush: 'sync' })

  async function select(version: string) {
    const id = ++requestId
    result.value = undefined
    matching.value = false
    options.selectOptifine(version)
    const runtime = options.data.runtime
    const minecraft = runtime.minecraft
    const forge = runtime.forge
    const isCurrent = () => id === requestId && options.data.runtime === runtime
      && runtime.minecraft === minecraft && runtime.optifine === version && runtime.forge === forge
      && !runtime.fabricLoader && !runtime.quiltLoader && !runtime.neoForged && !runtime.labyMod
    // Keep the existing prerequisite rules: an add-on cannot choose a base loader.
    if (!version || !forge || !isCurrent()) return
    matching.value = true
    try {
      const catalog = await options.getOptifineVersions()
      if (!isCurrent()) return
      const optifine = findOptifineCompatibility(runtime, catalog)
      if (isOptifineForgeCompatible(forge, optifine?.forge)) return
      if (!optifine?.forge) {
        result.value = { kind: 'unavailable', from: forge }
        return
      }
      const builds = await options.getForgeVersions(minecraft)
      if (!isCurrent()) return
      const compatible = builds.find(build => normalizeMinecraftVersion(build.mcversion) === normalizeMinecraftVersion(minecraft)
        && isOptifineForgeCompatible(build.version, optifine.forge))
      if (!compatible) {
        result.value = { kind: 'unavailable', from: forge }
        return
      }
      options.selectForge(compatible.version)
      result.value = { kind: 'adjusted', from: forge, to: compatible.version }
    } catch {
      if (isCurrent()) result.value = { kind: 'failed', from: forge }
    } finally {
      if (id === requestId) matching.value = false
    }
  }

  return { select, matching, result }
}
