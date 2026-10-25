import { LauncherAppPlugin } from '@xmcl/runtime/app'
import { autoUpdater } from 'electron-updater'

export const pluginAutoUpdate: LauncherAppPlugin = async () => {
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoDownload = false
}
