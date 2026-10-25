<template>
  <div class="misc-page" data-testid="misc-page">
    <header class="misc-header"><v-icon color="primary" :size="24">widgets</v-icon><h1>{{ t('customDownload.misc') }}</h1></header>
    <main class="misc-content">
      <MiscToolbox />
      <SettingCard :title="t('customDownload.title')" icon="download">
        <form @submit.prevent="start">
          <v-text-field v-model="url" data-testid="custom-download-url" :label="t('customDownload.url')" placeholder="https://example.com/file.zip" variant="outlined" density="comfortable" autocomplete="off" spellcheck="false" :error-messages="url && !validUrl ? t('customDownload.invalidUrl') : []" hide-details="auto" />
          <div class="destination-row mt-4">
            <v-text-field :model-value="destination?.path || ''" :label="t('customDownload.destination')" :placeholder="t('customDownload.chooseHint')" variant="outlined" density="comfortable" readonly hide-details />
            <v-btn variant="tonal" prepend-icon="folder_open" :disabled="!validUrl || busy" @click="choose">{{ t('customDownload.choose') }}</v-btn>
          </div>
          <p class="text-body-2 text-medium-emphasis mt-4 mb-1">{{ t('customDownload.description') }}</p>
          <p class="text-caption text-medium-emphasis mb-4">{{ t('customDownload.websiteHint') }}</p>
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" closable @click:close="error=''">{{ error }}</v-alert>
          <div class="download-actions"><v-btn type="submit" color="primary" variant="flat" prepend-icon="download" :loading="busy" :disabled="!validUrl || !destination || busy" data-testid="custom-download-start">{{ t('customDownload.start') }}</v-btn></div>
        </form>
        <section class="download-history" :aria-label="t('customDownload.tasks')">
          <div class="tasks-header"><h2>{{ t('customDownload.tasks') }}</h2><span v-if="jobs.length" class="text-caption text-medium-emphasis">{{ t('customDownload.sessionHint') }}</span></div>
          <div v-if="!jobs.length" class="empty-downloads"><v-icon :size="30">download</v-icon><p>{{ t('customDownload.empty') }}</p></div>
          <article v-for="job in jobs" :key="job.id" class="download-job" :data-download-state="job.state">
            <div class="job-top"><v-icon :size="23" color="primary">{{ job.state === 'completed' ? 'task_alt' : 'insert_drive_file' }}</v-icon><div class="job-name"><strong>{{ job.name }}</strong><span class="text-caption text-medium-emphasis" :title="job.destination">{{ job.destination }}</span></div><v-chip size="small" variant="tonal">{{ t('customDownload.states.' + job.state) }}</v-chip></div>
            <v-progress-linear v-if="active(job)" :model-value="job.total ? Math.min(100,job.progress/job.total*100) : 0" :indeterminate="!job.total" color="primary" height="4" rounded class="mt-4" />
            <div class="job-bottom"><div class="text-caption text-medium-emphasis job-metadata"><span>{{ size(job.progress) }}{{ job.total ? ' / '+size(job.total) : '' }}</span><span v-if="job.state === 'downloading'">{{ size(job.speed) }}/s</span><span v-if="job.state === 'downloading' && job.total && job.speed">{{ t('customDownload.remaining', { seconds: Math.ceil(Math.max(0,job.total-job.progress)/job.speed) }) }}</span></div><div class="job-buttons"><v-btn v-if="active(job)" variant="text" size="small" :disabled="job.state === 'cancelling'" @click="command('cancel',job.id)">{{ t('customDownload.cancel') }}</v-btn><v-btn v-if="job.state === 'failed' || job.state === 'cancelled'" variant="tonal" size="small" @click="command('retry',job.id)">{{ t('customDownload.retry') }}</v-btn><v-btn v-if="job.state === 'completed'" variant="text" size="small" prepend-icon="folder_open" @click="command('reveal',job.id)">{{ t('customDownload.reveal') }}</v-btn></div></div>
            <p v-if="job.state === 'failed'" role="alert" class="text-body-2 mt-2">{{ job.error === 'http' ? t(job.httpStatus === 403 ? 'customDownload.forbidden' : 'customDownload.http', { status: job.httpStatus }) : message(job.error || 'network') }}</p>
            <p class="job-source text-caption text-medium-emphasis">{{ job.source }}</p>
          </article>
        </section>
      </SettingCard>
    </main>
  </div>
</template>

<script lang="ts" setup>
import SettingCard from '@/components/SettingCard.vue'
import MiscToolbox from '@/components/MiscToolbox.vue'
import type { CustomDownload } from '../../../xmcl-electron-app/customDownloads'
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const url = ref(''), busy = ref(false), error = ref('')
const destination = ref<{ token: string; path: string }>()
const jobs = ref<CustomDownload[]>([])
const validUrl = computed(() => { try { const value = new URL(url.value.trim()); return ['http:', 'https:'].includes(value.protocol) && !!value.hostname && !value.username && !value.password } catch { return false } })
watch(url, () => { destination.value = undefined; error.value = '' })
const active = (job: CustomDownload) => ['downloading', 'cancelling'].includes(job.state)
function size(bytes: number) { if (!Number.isFinite(bytes) || bytes < 0) return '0 B'; const units = ['B','KiB','MiB','GiB','TiB']; let index=0; while(bytes>=1024 && index<units.length-1){bytes/=1024;index++} return `${bytes.toFixed(index ? 1 : 0)} ${units[index]}` }
function message(code: string) { return t('customDownload.errors.' + (['invalidUrl','invalidDestination','destinationChanged','destinationBusy','tooMany','chooseAgain','diskFull','permission','desktopOnly'].includes(code) ? code : 'network')) }
function client() { if(typeof customDownloads === 'undefined') throw new Error('desktopOnly'); return customDownloads }
function showError(cause: unknown) { const code = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : ''; error.value = message(code) }
async function choose() { if(busy.value)return;busy.value=true;error.value='';try{destination.value=await client().choose(url.value)}catch(e){showError(e)}finally{busy.value=false} }
async function start() { if(busy.value || !destination.value || !validUrl.value)return;busy.value=true;error.value='';try{await client().start(url.value,destination.value.token);destination.value=undefined;jobs.value=await client().list()}catch(e){showError(e)}finally{busy.value=false} }
async function command(action: 'cancel' | 'retry' | 'reveal', id: string) { try{await client()[action](id);jobs.value=await client().list()}catch(e){showError(e)} }
let stopped=false,timer:ReturnType<typeof setTimeout>|undefined
async function refresh(){try{jobs.value=await client().list()}catch(e){showError(e)}if(!stopped)timer=setTimeout(refresh,jobs.value.some(active)?500:2000)}
watchEffect(()=>{document.title=`TORA Minecraft Launcher - ${t('customDownload.misc')}`})
onMounted(refresh)
onUnmounted(()=>{stopped=true;if(timer)clearTimeout(timer)})
</script>

<style scoped>
.misc-page{height:100%;display:flex;flex-direction:column;overflow:hidden;color:rgb(var(--v-theme-on-surface))}
.misc-header{display:flex;align-items:center;gap:12px;padding:22px 30px 18px;flex-shrink:0}.misc-header h1{font-size:22px;font-weight:600}
.misc-content{padding:14px 30px 30px;overflow:auto;flex:1;width:100%;max-width:1080px;margin:0 auto}.destination-row{display:flex;gap:12px;align-items:center}.destination-row .v-input{min-width:0}.download-actions{display:flex;justify-content:flex-end}
.misc-page :deep(.v-field),.misc-page :deep(.v-btn){border-radius:var(--card-item-radius,10px)}.misc-page :deep(.v-btn){text-transform:none;letter-spacing:normal}
.download-history{margin-top:24px;padding-top:24px;border-top:1px solid rgba(var(--v-theme-on-surface),.09)}
.tasks-header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:16px}.tasks-header h2{font-size:16px;font-weight:600}
.empty-downloads{display:flex;align-items:center;gap:12px;padding:24px 6px;color:rgba(var(--v-theme-on-surface),.55);font-size:14px}.download-job{padding:16px 0}.download-job + .download-job{border-top:1px solid rgba(var(--v-theme-on-surface),.09)}
.job-top{display:flex;gap:12px;align-items:center}.job-name{min-width:0;flex:1}.job-name strong{font-size:14px;font-weight:600}.job-name span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.job-bottom{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px}.job-metadata{display:flex;gap:14px;flex-wrap:wrap}.job-buttons{display:flex;gap:6px;flex-shrink:0}.job-source{overflow-wrap:anywhere;margin-top:4px}
@media(max-width:900px){.misc-content{padding:12px 20px 24px}.misc-header{padding:22px 20px 18px}.tasks-header{align-items:flex-start;flex-direction:column;gap:4px}.job-bottom{align-items:flex-start;flex-direction:column}}
</style>
