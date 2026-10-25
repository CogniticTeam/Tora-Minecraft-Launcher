import type { LauncherAppPlugin } from '@xmcl/runtime/app'
import { kMultiplayerHostFactory } from '@xmcl/runtime/peer'

/** Together is removed from TORA. Reject stale callers without starting any networking. */
export const pluginMultiplayer: LauncherAppPlugin = (app) => {
  app.registry.register(kMultiplayerHostFactory, async () => {
    throw new Error('Minecraft Together has been removed from TORA Minecraft Launcher.')
  })
}
