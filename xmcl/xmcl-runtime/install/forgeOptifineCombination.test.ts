import { expect, it, vi } from 'vitest'
import { installForgeOptifineCombination } from './forgeOptifineCombination'
const runtime = { minecraft: '1.20.1', forge: '47.2.18', optifine: 'HD_U_I6' }
function setup() {
  const order: string[] = []
  return { order, getVersions: vi.fn(async () => [{ mcversion: '1.20.1', type: 'HD_U', patch: 'I6', forge: 'Forge 47.2.18' }]),
    installBase: vi.fn(async (_runtime: unknown) => { order.push('base'); return '1.20.1-forge-47.2.18' }),
    installAddon: vi.fn(async (_version: unknown) => { order.push('addon') }),
    finish: vi.fn(async () => { order.push('finish') }) }
}
it('installs Forge first, then the addon, then commits the normalized runtime', async () => {
  const operations = setup()
  expect(await installForgeOptifineCombination(runtime, operations)).toBe('1.20.1-forge-47.2.18')
  expect(operations.order).toEqual(['base', 'addon', 'finish'])
  expect(operations.installBase).toHaveBeenCalledWith({ ...runtime, optifine: '' })
  expect(runtime.optifine).toBe('HD_U_I6')
})
it('rejects unsupported pairs before starting any installation', async () => {
  const operations = setup()
  await expect(installForgeOptifineCombination({ ...runtime, forge: '47.4.0' }, operations)).rejects.toThrow('47.2.18')
  expect(operations.installBase).not.toHaveBeenCalled()
  expect(operations.installAddon).not.toHaveBeenCalled()
})
it('retains a pending selection when the addon download fails', async () => {
  const operations = setup(); operations.installAddon.mockRejectedValue(new Error('download failed'))
  await expect(installForgeOptifineCombination(runtime, operations)).rejects.toThrow('download failed')
  expect(operations.finish).not.toHaveBeenCalled()
})
it('does not try the addon when Forge installation fails', async () => {
  const operations = setup(); operations.installBase.mockRejectedValue(new Error('forge failed'))
  await expect(installForgeOptifineCombination(runtime, operations)).rejects.toThrow('forge failed')
  expect(operations.installAddon).not.toHaveBeenCalled()
})
