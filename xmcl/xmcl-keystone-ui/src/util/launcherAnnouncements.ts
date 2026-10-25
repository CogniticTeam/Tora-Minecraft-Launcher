import { parseCommunityExternalLink } from './communityForum'

export interface LauncherAnnouncement { id: string; title: string; body: string; button_label: string; url: string; revision: number; ends_at: number }
export function parseLauncherAnnouncements(value: unknown, now = Date.now()): LauncherAnnouncement[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { data?: unknown }).data)) return []
  return ((value as { data: unknown[] }).data).slice(0, 10).flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const a = value as LauncherAnnouncement
    if (!/^pop_[a-f0-9]{32}$/.test(a.id) || typeof a.title !== 'string' || !a.title || a.title.length > 80 || typeof a.body !== 'string' || a.body.length > 4000 || typeof a.button_label !== 'string' || a.button_label.length > 24 || typeof a.url !== 'string' || !Number.isSafeInteger(a.revision) || a.revision < 1 || !Number.isSafeInteger(a.ends_at) || a.ends_at <= now) return []
    if (a.url) { try { if (new URL(a.url).protocol !== 'https:') return []; parseCommunityExternalLink(a.url) } catch { return [] } }
    return [a]
  })
}
export function announcementKey(value: Pick<LauncherAnnouncement, 'id' | 'revision'>) { return `${value.id}:${value.revision}` }
