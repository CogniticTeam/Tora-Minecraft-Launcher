import { app, ipcMain, net, type WebContents } from 'electron'
import { join } from 'node:path'
import { TerracottaManager } from './TerracottaManager'
import type { EnvironmentManifest } from '../instanceCare'

export class TerracottaController {
  private readonly owners = new Set<number>()
  private readonly manager = new TerracottaManager(join(app.getPath('userData'), 'components', 'terracotta-0.4.2'), (url, init) => net.fetch(url, init))

  constructor(private readonly beforeExit: () => Promise<void>, private readonly getEnvironment: (path?:string)=>Promise<EnvironmentManifest|undefined>) {
    ipcMain.handle('tora:terracotta', async ({ sender }, action, player, room) => {
      if (!this.owners.has(sender.id)) throw new Error('terracotta_forbidden')
      if (action === 'status') return this.manager.status()
      if (action === 'prepare') return this.manager.prepare()
      if (action === 'inspect') return this.manager.inspect(player,await this.getEnvironment(room))
      if (action === 'host') this.manager.setEnvironment(await this.getEnvironment(room))
      if (action === 'host' || action === 'join' || action === 'leave') return this.manager.change(action, player, room)
      throw new Error('terracotta_invalid_action')
    })
    let quitting = false
    app.on('before-quit', event => {
      if (quitting || !this.manager.needsShutdown) return
      quitting = true; event.preventDefault()
      void this.beforeExit().finally(() => app.exit(0))
    })
  }

  dispose() { return this.manager.dispose() }

  attach(sender: WebContents) { this.owners.add(sender.id) }
  detach(id: number) { this.owners.delete(id) }
}
