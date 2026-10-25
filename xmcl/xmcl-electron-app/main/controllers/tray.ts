import { ElectronController } from '@/ElectronController'
import { darkTray, dockIcon, lightTray } from '@/utils/icons'
import { BaseService } from '@xmcl/runtime/app'
import { app, Menu, Tray, nativeTheme, nativeImage } from 'electron'
import { ControllerPlugin } from './plugin'
import { kSettings } from '@xmcl/runtime/settings'

export const trayPlugin: ControllerPlugin = function (this: ElectronController) {
  const { t } = this.i18n
  let checkUpdate: (() => void) | undefined
  const showLauncher = async () => {
    if ((!this.mainWin || this.mainWin.isDestroyed()) && this.activatedManifest) await this.activate(this.activatedManifest)
    const window = this.mainWin
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    return window
  }
  const createMenu = () => Menu.buildFromTemplate([
    { label: t('showLauncher'), click: () => { void showLauncher() } },
    { label: t('startGame'), click: () => {
      void showLauncher().then(window => {
        if (!window || window.isDestroyed()) return
        const send = () => { if (!window.isDestroyed()) window.webContents.send('launch-selected') }
        if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
        else send()
      }).catch(error => this.logger.warn(error))
    } },
    { label: t('checkUpdate'), enabled: !!checkUpdate, click: () => { checkUpdate?.() } },
    { label: t('quit'), click: () => { this.app.quit() } },
  ])

  const getTrayImage = (dark: string, light: string) => {
    const path = nativeTheme.shouldUseDarkColors ? dark : light
    if (this.app.platform.os === 'osx') {
      const icon = nativeImage.createFromPath(path)
      return icon.resize({ width: 20, height: 20 })
    }
    return path
  }

  this.app.waitEngineReady().then(async () => {
    this.app.registry.get(BaseService).then(service => {
      checkUpdate = () => service.checkUpdate()
      tray.setContextMenu(createMenu())
    })
    this.app.registry.get(kSettings).then(state => {
      state.subscribe('config', () => {
        tray.setToolTip(t('title'))
        tray.setContextMenu(createMenu())
      }).subscribe('localeSet', () => {
        tray.setToolTip(t('title'))
        tray.setContextMenu(createMenu())
      })
    })

    const tray = new Tray(getTrayImage(darkTray, lightTray))
    if (this.app.platform.os === 'windows') {
      tray.on('double-click', () => {
        const window = this.mainWin
        if (window) {
          if (window.isVisible()) {
            window.focus()
          } else {
            window.show()
            if (this.maximized) {
              window.maximize()
            }
          }
        }
      })
    }

    tray.setToolTip(t('title'))
    tray.setContextMenu(createMenu())

    if (app.dock) {
      // Preserve transparency with 10% optical padding on each Dock icon edge.
      app.dock.setIcon(nativeImage.createFromPath(dockIcon))
      app.on('activate', () => {
        if (this.mainWin && !this.mainWin.isDestroyed()) {
          this.mainWin?.show()
        } else if (this.activatedManifest) {
          this.activate(this.activatedManifest, false)
        }
      })
    }
    app.on('before-quit', () => {
      this.tray?.destroy()
    })
    this.tray = tray
  })

  this.app.on('app-booted', (man) => {
    this.tray?.setImage(getTrayImage(man.iconSets.darkTrayIcon, man.iconSets.trayIcon))
  })
}
