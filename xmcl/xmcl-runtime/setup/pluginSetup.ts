import Drive from 'node-disk-info/dist/classes/drive'
import { join, parse } from 'path'
import { setTimeout } from 'timers/promises'
import { isValidPathName } from '~/util/validate'
import { LauncherAppPlugin } from '../app'
import { createLazyWorker } from '@xmcl/worker'
import { SetupWorker } from './setupWorker'
// eslint-disable-next-line import/default
import createSetupWorker from './setupWorkerEntry?worker'
import { Exception } from '@xmcl/runtime-api'
import { GAME_DIRECTORY_NAME } from '../constant'
import { access, constants } from 'fs/promises'

/**
 * Returns true if the drive is a real user-accessible filesystem suitable as
 * a data-root recommendation.  On Linux (including Flatpak) `getDiskInfo()`
 * surfaces every kernel/virtual mount (`tmpfs`, `proc`, `overlay`, …) and
 * every Flatpak bind-mount (`/etc/timezone`, `/usr`, `/dev/shm`, …).
 * We suppress those so the setup wizard only shows sensible choices.
 */
function isUserDrive(drive: { filesystem: string; mounted: string }): boolean {
  if (process.platform === 'darwin') {
    if (!/^\/dev\/disk\d+(?:s\d+)*$/.test(drive.filesystem)) return false
    if (drive.mounted === '/' || drive.mounted === '/System/Volumes/Data') return true
    // Exclude VM, Preboot, simulators and virtual device mounts. The external
    // volume's write access is checked below without creating or changing files.
    return /^\/Volumes\/[^/]+$/.test(drive.mounted)
  }
  if (process.platform === 'linux') {
    // Virtual / kernel / container filesystem types that are never writable
    // user-data locations.
    const VIRTUAL_FS = new Set([
      'tmpfs', 'devtmpfs', 'devpts', 'sysfs', 'proc', 'procfs',
      'cgroup', 'cgroup2', 'pstore', 'bpf', 'tracefs', 'debugfs',
      'securityfs', 'hugetlbfs', 'mqueue', 'fusectl', 'rpc_pipefs',
      'nfsd', 'configfs', 'autofs', 'efivarfs', 'selinuxfs',
      'fuse.portal', 'fuse.gvfsd-fuse', 'overlay', 'squashfs',
    ])

    if (VIRTUAL_FS.has(drive.filesystem.toLowerCase())) {
      return false
    }

    const mp = drive.mounted

    // USB / removable media mounted under /run/media or /media are fine.
    if (mp.startsWith('/run/media/') || mp.startsWith('/media/')) {
      return true
    }

    // Network / fuse user mounts under /mnt are also acceptable.
    if (mp.startsWith('/mnt/')) {
      return true
    }

    // Block-list system path prefixes that should never be data roots.
    const SYSTEM_PREFIXES = [
      '/dev', '/sys', '/proc', '/run', '/tmp',
      '/usr', '/etc', '/lib', '/lib32', '/lib64', '/libx32',
      '/bin', '/sbin', '/boot', '/snap',
    ]

    for (const prefix of SYSTEM_PREFIXES) {
      if (mp === prefix || mp.startsWith(prefix + '/')) {
        return false
      }
    }
  }

  return true
}

export const pluginSetup: LauncherAppPlugin = async (app) => {
  const logger = app.getLogger('Setup')
  const [worker, dispose] = createLazyWorker<SetupWorker>(
    createSetupWorker,
    { methods: ['getDiskInfo'] },
    logger,
    Exception,
  )
  app.registryDisposer(dispose)
  logger.log('Setup worker created')

  const getDiskInfo = async () => {
    try {
      const infos = await worker.getDiskInfo()
      for (const i of infos) {
        Object.setPrototypeOf(i, Drive.prototype)
      }
      return infos
    } catch (e) {
      throw Object.assign(new Error(), e)
    }
  }

  app.controller.handle('preset', async () => {
    // E2E isolation: when the harness provides a game-data root, use it as the
    // onboarding default so the wizard never points at the real user data.
    const defaultPath = process.env.XMCL_E2E_GAME_DATA || join(app.host.getPath('home'), GAME_DIRECTORY_NAME)
    const getPath = (driveSymbol: string) => {
      if (process.platform === 'darwin' && driveSymbol === '/System/Volumes/Data') {
        // The APFS Data volume backs /Users through firmlinks. Its root is not
        // a user-writable destination; recommend the existing home default.
        return defaultPath
      }
      const parsedHome = parse(defaultPath)
      if (
        isValidPathName(defaultPath) &&
        parsedHome.root.toLocaleLowerCase().startsWith(driveSymbol.toLocaleLowerCase())
      ) {
        return defaultPath
      }
      return join(driveSymbol, GAME_DIRECTORY_NAME)
    }
    const getAllDrived = async () => {
      try {
        const startTime = Date.now()
        const drives = await Promise.race([getDiskInfo(), setTimeout(4000).then(() => [])])
        logger.log(`Get disk info in ${Date.now() - startTime}ms`)
        let candidates = drives.filter(isUserDrive)
        if (process.platform === 'darwin') {
          // The sealed system root and Data volume share the APFS container;
          // prefer the writable Data volume instead of showing a duplicate root.
          if (candidates.some(d => d.mounted === '/System/Volumes/Data')) {
            candidates = candidates.filter(d => d.mounted !== '/')
          }
          const writable = await Promise.all(candidates.map(async (drive) => {
            if (!drive.mounted.startsWith('/Volumes/')) return drive
            return access(drive.mounted, constants.W_OK).then(() => drive, () => undefined)
          }))
          candidates = writable.filter((drive): drive is Drive => drive !== undefined)
        }
        return candidates.map((d) => ({
          filesystem: d.filesystem,
          blocks: d.blocks,
          used: d.used,
          available: d.available,
          capacity: d.capacity,
          mounted: d.mounted,
          selectedPath: getPath(d.mounted),
        }))
      } catch (e) {
        logger.warn('Failed to get drives')
        logger.error(e as any)
        return []
      }
    }
    const drives = await getAllDrived()
    return {
      locale: app.host.getLocale(),
      minecraftPath: app.minecraftDataPath,
      defaultPath,
      drives,
    }
  })
}
