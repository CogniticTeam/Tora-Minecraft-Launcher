import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { LauncherApp } from '@xmcl/runtime/app'
import { kDownloadOptions } from '@xmcl/runtime/network'
import { CustomDownloadManager, describeDownloadDestination, suggestDownloadName, type DownloadDestination } from './CustomDownloadManager'

export class CustomDownloadsController {
  private readonly owners = new Set<number>()
  // The renderer receives a one-use grant from the native Save dialog, never
  // an IPC method that accepts an arbitrary destination path.
  private readonly grants = new Map<string, { owner: number; target: DownloadDestination; expires: number }>()
  private readonly manager: CustomDownloadManager
  constructor(launcher: LauncherApp) {
    this.manager = new CustomDownloadManager(() => launcher.registry.get(kDownloadOptions))
    launcher.registryDisposer(() => this.manager.dispose())
    ipcMain.handle('tora:custom-downloads', async ({ sender }, action, value, token) => {
      if (!this.owners.has(sender.id)) throw new Error('forbidden')
      if (action === 'choose') {
        const name = suggestDownloadName(value)
        const parent = BrowserWindow.fromWebContents(sender)
        const options = { defaultPath: join(app.getPath('downloads'), name), properties: ['createDirectory', 'showOverwriteConfirmation'] as ('createDirectory' | 'showOverwriteConfirmation')[] }
        const selected = await (parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options))
        if (selected.canceled || !selected.filePath) return
        const target = await describeDownloadDestination(selected.filePath)
        for (const [key, grant] of this.grants) if (grant.expires < Date.now() || grant.owner === sender.id) this.grants.delete(key)
        const key = randomUUID()
        this.grants.set(key, { owner: sender.id, target, expires: Date.now() + 60 * 60 * 1000 })
        return { token: key, path: target.path }
      }
      if (action === 'start') {
        const grant = this.grants.get(token)
        if (!grant || grant.owner !== sender.id || grant.expires < Date.now()) throw new Error('chooseAgain')
        const state = this.manager.start(value, grant.target)
        this.grants.delete(token)
        return state
      }
      if (action === 'list') return this.manager.list()
      if (action === 'cancel') return this.manager.cancel(value)
      if (action === 'retry') return this.manager.retry(value)
      if (action === 'reveal') return shell.showItemInFolder(this.manager.completedPath(value))
      throw new Error('invalidAction')
    })
  }
  attach(sender: WebContents) { this.owners.add(sender.id) }
  detach(id: number) {
    this.owners.delete(id)
    for (const [key, grant] of this.grants) if (grant.owner === id) this.grants.delete(key)
  }
}
