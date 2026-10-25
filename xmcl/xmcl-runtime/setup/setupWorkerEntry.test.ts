import { execFileSync } from 'child_process'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@xmcl/worker/helper', () => ({ setHandler: vi.fn() }))

import { getDarwinDiskInfo, parseDarwinDiskInfo } from './setupWorkerEntry'

const header = 'Filesystem 1024-blocks Used Available Capacity Mounted on'

describe('macOS setup disk information', () => {
  it('converts KiB to bytes while preserving spaced filesystem labels and mount paths', () => {
    const drives = parseDarwinDiskInfo(`${header}
/dev/disk3s1 482746452 411608656 33993484 93% /System/Volumes/Data
/dev/disk7s1 1000000000 200000000 800000000 20% /Volumes/My Games
map auto_home 0 0 0 100% /System/Volumes/Data/home
devices -- file:///Users/example/Device Service/ 1073741824 0 1073741824 0% /Users/example/DeviceFS
`)
    expect(drives[0].available).toBe(34809327616)
    expect(drives[0].used).toBe(421487263744)
    expect(drives[0].available / 1024 ** 3).toBeCloseTo(32.42, 2)
    expect(drives[1].mounted).toBe('/Volumes/My Games')
    expect(drives[2].filesystem).toBe('map auto_home')
    expect(drives[2].mounted).toBe('/System/Volumes/Data/home')
    expect(drives[3].filesystem).toBe('devices -- file:///Users/example/Device Service/')
    expect(drives[3].mounted).toBe('/Users/example/DeviceFS')
    expect(drives.every(d => d.mounted.startsWith('/'))).toBe(true)
  })

  it('rejects implicit 512-byte units and ignores malformed or overflowing records', () => {
    expect(() => parseDarwinDiskInfo('Filesystem 512-blocks Used Available Capacity Mounted on')).toThrow('1024-byte')
    const drives = parseDarwinDiskInfo(`${header}
/dev/disk1 9007199254740992 1 1 1% /overflow
/dev/disk2 100 -1 99 1% /negative
/dev/disk3 100 1 99 1% 100%
malformed data
/dev/disk4 100 25 75 25% /Volumes/Valid
`)
    expect(drives).toHaveLength(1)
    expect(drives[0].mounted).toBe('/Volumes/Valid')
    expect(drives[0].available).toBe(76800)
  })

  it.skipIf(process.platform !== 'darwin')('reads real macOS capacities with the same total as explicit df -kP', async () => {
    const drives = await getDarwinDiskInfo()
    const expected = parseDarwinDiskInfo(execFileSync('/bin/df', ['-kP'], {
      encoding: 'utf8', timeout: 3000, env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    }))
    const actualHome = drives.find(d => d.mounted === '/System/Volumes/Data') || drives.find(d => d.mounted === '/')
    const expectedHome = expected.find(d => d.mounted === actualHome?.mounted)
    expect(actualHome).toBeDefined()
    expect(actualHome!.blocks).toBe(expectedHome!.blocks)
    expect(actualHome!.available).toBeGreaterThan(1024 ** 3)
    expect(actualHome!.available).toBeLessThan(actualHome!.blocks)
  })
})
