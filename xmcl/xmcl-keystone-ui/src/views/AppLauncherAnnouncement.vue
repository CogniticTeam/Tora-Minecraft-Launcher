<template>
  <v-dialog :model-value="shown" max-width="550" @update:model-value="value => { if (!value) dismiss() }">
    <v-card v-if="current" class="launcher-announcement pa-6">
      <div class="flex items-center gap-3 mb-4"><img :src="logo" alt="TMCL" width="28" height="28" /><span class="text-caption text-medium-emphasis">TORA Minecraft Launcher</span><v-spacer /><v-btn icon="close" size="small" variant="text" aria-label="关闭公告" @click="dismiss" /></div>
      <h2 class="text-h6 mb-4">{{ current.title }}</h2>
      <p class="launcher-announcement-body">{{ current.body }}</p>
      <v-card-actions class="px-0 pt-6 pb-0"><v-spacer /><v-btn variant="text" @click="dismiss">知道了</v-btn><v-btn v-if="current.url && current.button_label" color="primary" variant="flat" @click="externalShown = true">{{ current.button_label }}</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="externalShown" max-width="460"><v-card class="pa-6"><h2 class="text-h6 mb-4">打开外部网站</h2><p class="text-body-2 break-all">{{ current?.url }}</p><v-card-actions class="px-0 pt-5 pb-0"><v-spacer /><v-btn variant="text" @click="externalShown = false">取消</v-btn><v-btn color="primary" variant="flat" @click="openLink">打开网站</v-btn></v-card-actions></v-card></v-dialog>
</template>
<script setup lang="ts">
import { version as launcherVersion } from '../../../../package.json'
import logo from '@/assets/tora.png'
import { kEnvironment } from '@/composables/environment'
import { COMMUNITY_API_ORIGIN } from '@/util/community'
import { parseCommunityExternalLink } from '@/util/communityForum'
import { announcementKey, parseLauncherAnnouncements, type LauncherAnnouncement } from '@/util/launcherAnnouncements'
import { injection } from '@/util/inject'

const env = injection(kEnvironment)
const shown = ref(false), externalShown = ref(false), current = shallowRef<LauncherAnnouncement>()
const storageKey = 'tmcl-announcements-seen'
let fetched = false, disposed = false, timer: ReturnType<typeof setTimeout> | undefined
async function checkAnnouncements(value: { os: string; version: string }) {
  if (fetched) return
  fetched = true
  try {
    const platform = /osx|darwin/.test(value.os) ? 'darwin' : /win/.test(value.os) ? 'win32' : 'linux'
    const url = new URL('/v1/launcher/announcements', COMMUNITY_API_ORIGIN)
    url.searchParams.set('platform', platform); url.searchParams.set('version', value.version)
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok || disposed) return
    const announcements = parseLauncherAnnouncements(await response.json())
    console.debug('[TMCL] 公告检查完成', { count: announcements.length })
    let seen: string[] = []
    try { const stored = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(stored)) seen = stored.filter(v => typeof v === 'string').slice(-100) } catch { /* Do not block startup when storage is unavailable. */ }
    current.value = announcements.find(a => !seen.includes(announcementKey(a)))
    if (current.value) {
      const present = () => {
        if (disposed || !current.value || current.value.ends_at <= Date.now()) return
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) { timer = setTimeout(present, 3000); return }
        shown.value = true
      }
      timer = setTimeout(present, 1500)
    }
  } catch { console.debug('[TMCL] 公告检查暂不可用，稍后启动时重试') }
}
watch(env, value => { if (value) void checkAnnouncements(value) }, { immediate: true })
const fallback = setTimeout(() => {
  const os = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux'
  void checkAnnouncements({ os, version: launcherVersion })
}, 1500)
function dismiss() {
  if (current.value) {
    try { const previous = JSON.parse(localStorage.getItem(storageKey) || '[]'); const seen = Array.isArray(previous) ? previous.filter(v => typeof v === 'string') : []; localStorage.setItem(storageKey, JSON.stringify([...new Set([...seen, announcementKey(current.value)])].slice(-100))) } catch { /* This session still dismisses normally. */ }
  }
  shown.value = false; externalShown.value = false
}
function openLink() { if (!current.value?.url) return; try { window.open(parseCommunityExternalLink(current.value.url), 'browser'); dismiss() } catch { externalShown.value = false } }
onBeforeUnmount(() => { disposed = true; clearTimeout(fallback); if (timer) clearTimeout(timer) })
</script>
<style scoped>
.launcher-announcement{border-radius:var(--surface-dialog-radius,20px)}.launcher-announcement-body{font-size:14px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto;margin:0}
</style>
