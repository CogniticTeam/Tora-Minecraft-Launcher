import { describe, expect, test, vi } from 'vitest'
import { effectScope, reactive } from 'vue'
import type { InstanceData, OptifineCompatibilityVersion } from '@xmcl/instance'
import type { ForgeVersion } from '@xmcl/runtime-api'
import { useOptifineForgeSelection } from './optifineForgeSelection'

const catalog: OptifineCompatibilityVersion[] = [
  { mcversion: '1.20.1', type: 'HD_U', patch: 'I6', forge: 'Forge 47.2.18' },
  { mcversion: '1.20.1', type: 'HD_U', patch: 'I5', forge: 'Forge 47.1.0' },
]
function harness() {
  const data = reactive<Pick<InstanceData, 'runtime' | 'version'>>({ runtime: {
    minecraft: '1.20.1', forge: '47.4.28', optifine: '', fabricLoader: '', quiltLoader: '', neoForged: '', labyMod: '',
  }, version: 'old-pinned-version' })
  const getOptifineVersions = vi.fn(async () => catalog)
  const getForgeVersions = vi.fn(async () => [
    { mcversion: '1.20.1', version: '47.4.28', date: '', type: 'common' },
    { mcversion: '1.20.1', version: '47.2.18', date: '', type: 'common' },
    { mcversion: '1.20.1', version: '47.1.0', date: '', type: 'common' },
  ] as ForgeVersion[])
  const selectForge = vi.fn((version: string) => { data.runtime.forge = version })
  const selectOptifine = (version: string) => {
    if (version && (!data.runtime.forge || data.runtime.fabricLoader || data.runtime.neoForged || data.runtime.quiltLoader || data.runtime.labyMod)) return
    data.runtime.optifine = version
    if (version) data.version = ''
  }
  const scope = effectScope()
  const selection = scope.run(() => useOptifineForgeSelection({ data, selectOptifine, selectForge, getOptifineVersions, getForgeVersions }))!
  return { ...selection, data, getOptifineVersions, getForgeVersions, selectForge, stop: () => scope.stop() }
}

describe('OptiFine selection matches Forge', () => {
  test('switches an incompatible Forge and preserves the selected OptiFine', async () => {
    const h = harness()
    try {
      await h.select('HD_U_I6')
      expect(h.data.runtime.forge).toBe('47.2.18')
      expect(h.data.runtime.optifine).toBe('HD_U_I6')
      expect(h.data.version).toBe('')
      expect(h.result.value).toEqual({ kind: 'adjusted', from: '47.4.28', to: '47.2.18' })
      h.data.runtime.forge = '47.4.28'
      expect(h.result.value).toBeUndefined()
    } finally { h.stop() }
  })
  test('keeps an already compatible Forge without fetching its catalog', async () => {
    const h = harness()
    try {
      h.data.runtime.forge = '47.2.18'
      await h.select('HD_U_I6')
      expect(h.getForgeVersions).not.toHaveBeenCalled()
      expect(h.selectForge).not.toHaveBeenCalled()
    } finally { h.stop() }
  })
  test.each(['', 'Forge N/A'])('keeps Forge unchanged for unverified metadata %s', async forge => {
    const h = harness()
    try {
      h.getOptifineVersions.mockResolvedValue([{ ...catalog[0], forge }])
      await h.select('HD_U_I6')
      expect(h.data.runtime.forge).toBe('47.4.28')
      expect(h.result.value?.kind).toBe('unavailable')
    } finally { h.stop() }
  })
  test('does not invent an unavailable Forge or use a build for another Minecraft', async () => {
    const h = harness()
    try {
      h.getForgeVersions.mockResolvedValue([{ mcversion: '1.20.2', version: '47.2.18', date: '', type: 'common' }])
      await h.select('HD_U_I6')
      expect(h.selectForge).not.toHaveBeenCalled()
      expect(h.result.value?.kind).toBe('unavailable')
    } finally { h.stop() }
  })
  test('matches legacy build-only metadata', async () => {
    const h = harness()
    try {
      h.data.runtime.minecraft = '1.12.2'
      h.data.runtime.forge = '14.23.5.2860'
      h.getOptifineVersions.mockResolvedValue([{ mcversion: '1.12.2', type: 'HD_U', patch: 'G5', forge: 'Forge #2847' }])
      h.getForgeVersions.mockResolvedValue([{ mcversion: '1.12.2', version: '14.23.5.2847', date: '', type: 'common' }])
      await h.select('HD_U_G5')
      expect(h.data.runtime.forge).toBe('14.23.5.2847')
    } finally { h.stop() }
  })
  test.each(['forge', 'minecraft', 'optifine', 'fabricLoader'] as const)('does not overwrite later user edits to %s while fetching', async key => {
    const h = harness()
    try {
      let finish!: (value: ForgeVersion[]) => void
      h.getForgeVersions.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      const pending = h.select('HD_U_I6')
      await vi.waitFor(() => expect(h.getForgeVersions).toHaveBeenCalled())
      h.data.runtime[key] = 'user-choice'
      finish([{ mcversion: '1.20.1', version: '47.2.18', date: '', type: 'common' }])
      await pending
      expect(h.selectForge).not.toHaveBeenCalled()
      expect(h.matching.value).toBe(false)
    } finally { h.stop() }
  })
  test('ignores an older response after a second OptiFine selection', async () => {
    const h = harness()
    try {
      let finish!: (value: ForgeVersion[]) => void
      h.getForgeVersions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const first = h.select('HD_U_I6')
      await vi.waitFor(() => expect(h.getForgeVersions).toHaveBeenCalled())
      await h.select('HD_U_I5')
      finish([{ mcversion: '1.20.1', version: '47.2.18', date: '', type: 'common' }])
      await first
      expect(h.data.runtime.forge).toBe('47.1.0')
      expect(h.data.runtime.optifine).toBe('HD_U_I5')
      expect(h.selectForge).toHaveBeenCalledTimes(1)
    } finally { h.stop() }
  })
  test('reports a metadata failure without changing Forge', async () => {
    const h = harness()
    try {
      h.getForgeVersions.mockRejectedValue(new Error('offline'))
      await h.select('HD_U_I6')
      expect(h.data.runtime.forge).toBe('47.4.28')
      expect(h.result.value?.kind).toBe('failed')
      expect(h.matching.value).toBe(false)
    } finally { h.stop() }
  })
  test.each(['forge', 'fabricLoader', 'quiltLoader', 'neoForged'] as const)('preserves prerequisite and mutual exclusion rules: %s', async key => {
    const h = harness()
    try {
      h.data.runtime[key] = key === 'forge' ? '' : '1'
      await h.select('HD_U_I6')
      expect(h.getOptifineVersions).not.toHaveBeenCalled()
      expect(h.selectForge).not.toHaveBeenCalled()
      expect(h.data.runtime.optifine).toBe('')
    } finally { h.stop() }
  })
  test('clearing OptiFine preserves the manually selected Forge', async () => {
    const h = harness()
    try {
      h.data.runtime.optifine = 'HD_U_I6'
      await h.select('')
      expect(h.data.runtime.forge).toBe('47.4.28')
      expect(h.getOptifineVersions).not.toHaveBeenCalled()
    } finally { h.stop() }
  })
})
