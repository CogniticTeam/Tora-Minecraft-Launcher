import { findOptifineCompatibility, getLoaderCompatibilityErrors, type OptifineCompatibilityVersion, type PartialRuntimeVersions } from '@xmcl/instance'

/** Install OptiFine as a Forge mod, never append legacy tweakClass arguments to modern Forge. */
export async function installForgeOptifineCombination<T>(
  runtime: PartialRuntimeVersions,
  operations: {
    getVersions(): Promise<OptifineCompatibilityVersion[]>
    installBase(runtime: PartialRuntimeVersions): Promise<T>
    installAddon(version: OptifineCompatibilityVersion): Promise<void>
    finish(): Promise<void>
  },
): Promise<T> {
  const versions = await operations.getVersions()
  const errors = getLoaderCompatibilityErrors(runtime, versions)
  if (errors.length) throw new Error(errors.join('\n'))
  const addon = findOptifineCompatibility(runtime, versions)
  if (!runtime.forge || !runtime.optifine || !addon) throw new Error('Forge + OptiFine 组合缺少必要版本信息。')
  const result = await operations.installBase({ ...runtime, optifine: '' })
  await operations.installAddon(addon)
  // Keep the pending addon on failure so the regular installation flow can retry it.
  await operations.finish()
  return result
}
