import { describe, expect, it } from 'vitest'
import { announcementKey, parseLauncherAnnouncements } from './launcherAnnouncements'

const popup = { id: 'pop_' + 'a'.repeat(32), title: '公告', body: '正常的启动器公告', button_label: '查看', url: 'https://example.com/', revision: 1, ends_at: Date.now() + 60000 }
describe('launcher announcement boundary', () => {
  it('accepts current bounded announcements and keeps display identity per revision', () => {
    expect(parseLauncherAnnouncements({ data: [popup] })).toEqual([popup])
    expect(announcementKey(popup)).not.toBe(announcementKey({ ...popup, revision: 2 }))
  })
  it('rejects expired, malformed and privileged link payloads without affecting startup', () => {
    for (const changes of [{ ends_at: 0 }, { title: 'a'.repeat(81) }, { body: 'a'.repeat(4001) }, { id: '__proto__' }, { revision: -1 }, { url: 'javascript:alert(1)' }, { url: 'https://localhost/admin' }, { url: 'https://user:secret@example.com/' }]) expect(parseLauncherAnnouncements({ data: [{ ...popup, ...changes }] })).toEqual([])
    expect(parseLauncherAnnouncements(null)).toEqual([])
  })
})
