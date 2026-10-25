import { describe, expect, it } from 'vitest'
import { getLoaderCompatibilityErrors, isOptifineForgeCompatible } from './loaderCompatibility'

const optifine = [{ mcversion: '1.20.1', type: 'HD_U', patch: 'I6', forge: 'Forge 47.2.18' }]
describe('loader compatibility', () => {
  it.each(['forge', 'fabricLoader', 'quiltLoader', 'neoForged'] as const)('accepts the independent %s base', base => {
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', [base]: '1' })).toEqual([])
  })
  it('rejects mutually exclusive bases', () => {
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', forge: '47.2.18', fabricLoader: '0.16.0' })[0]).toContain('互不兼容')
  })
  it.each([{}, { fabricLoader: '0.16.0' }, { quiltLoader: '0.26' }, { neoForged: '20.1' }])('requires a Forge prerequisite for OptiFine: %o', base => {
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', optifine: 'HD_U_I6', ...base }, optifine).length).toBeGreaterThan(0)
  })
  it('accepts only the catalog-confirmed Forge + OptiFine pair', () => {
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', forge: '47.2.18', optifine: 'HD_U_I6' }, optifine)).toEqual([])
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', forge: '47.4.0', optifine: 'HD_U_I6' }, optifine)[0]).toContain('47.2.18')
  })
  it('fails closed for N/A, missing metadata and a different Minecraft release', () => {
    const runtime = { minecraft: '1.20.1', forge: '47.2.18', optifine: 'HD_U_I6' }
    for (const values of [[], [{ ...optifine[0], forge: 'Forge N/A' }], [{ ...optifine[0], forge: undefined }], [{ ...optifine[0], mcversion: '1.20.4' }]]) {
      expect(getLoaderCompatibilityErrors(runtime, values).length).toBeGreaterThan(0)
    }
  })
  it('matches older catalog build numbers and rejects unrelated builds', () => {
    expect(isOptifineForgeCompatible('14.23.5.2847', 'Forge #2847')).toBe(true)
    expect(isOptifineForgeCompatible('14.23.5.2860', 'Forge #2847')).toBe(false)
  })
  it('rejects unverified LabyMod combinations while allowing legacy standalone imports when requested', () => {
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', labyMod: '4' }).length).toBeGreaterThan(0)
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', labyMod: '4' }, undefined, true)).toEqual([])
    expect(getLoaderCompatibilityErrors({ minecraft: '1.20.1', labyMod: '4', forge: '47.2.18' }, undefined, true).length).toBeGreaterThan(0)
  })
})
