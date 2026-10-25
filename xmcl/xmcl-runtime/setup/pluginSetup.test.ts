import Drive from 'node-disk-info/dist/classes/drive'
import { access } from 'fs/promises'
import { createLazyWorker } from '@xmcl/worker'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xmcl/worker', () => ({ createLazyWorker: vi.fn() }))
vi.mock('./setupWorkerEntry?worker', () => ({ default: vi.fn() }))
vi.mock('fs/promises', () => ({ access: vi.fn(), constants: { W_OK: 2 } }))
vi.mock('timers/promises', () => ({ setTimeout: () => new Promise(() => {}) }))

import { pluginSetup } from './pluginSetup'

describe('macOS setup drive recommendations', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

  it('keeps a home-backed Data volume and writable external disks, excluding system and malformed mounts', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.stubEnv('XMCL_E2E_GAME_DATA', undefined)
    const drive = (filesystem: string, mount: string) => new Drive(filesystem, 100000, 20000, 80000, '20%', mount)
    vi.mocked(createLazyWorker).mockReturnValue([{ getDiskInfo: async () => [
      drive('/dev/disk3s3s1', '/'),
      drive('/dev/disk3s1', '/System/Volumes/Data'),
      drive('/dev/disk3s6', '/System/Volumes/VM'),
      drive('/dev/disk3s4', '/System/Volumes/Preboot'),
      drive('/dev/disk5s1', '/Library/Developer/CoreSimulator/Volumes/iOS'),
      drive('devfs', '/dev'),
      drive('map auto_home', '100%'),
      drive('devices', '2147483648'),
      drive('/dev/disk6s1', '/Volumes/Recovery'),
      drive('/dev/disk7s1', '/Volumes/My Games'),
    ] }, vi.fn()] as any)
    vi.mocked(access).mockImplementation(async (mount) => {
      if (mount === '/Volumes/Recovery') throw Object.assign(new Error('read-only'), { code: 'EROFS' })
    })
    let preset: () => Promise<any>
    const app = {
      getLogger: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
      registryDisposer: vi.fn(),
      host: { getPath: () => '/Users/test', getLocale: () => 'zh-CN' },
      minecraftDataPath: '/Users/test/minecraft',
      controller: { handle: vi.fn((name, handler) => { preset = handler }) },
    }
    await pluginSetup(app as any, {} as any)
    const result = await preset!()
    expect(result.defaultPath).toBe('/Users/test/.tora-minecraft')
    expect(result.drives.map((d: Drive) => d.mounted)).toEqual(['/System/Volumes/Data', '/Volumes/My Games'])
    expect(result.drives[0].selectedPath).toBe('/Users/test/.tora-minecraft')
    expect(result.drives[1].selectedPath).toBe('/Volumes/My Games/.tora-minecraft')
    expect(access).toHaveBeenCalledWith('/Volumes/Recovery', 2)
    expect(access).not.toHaveBeenCalledWith('/System/Volumes/Data', 2)
  })
})
