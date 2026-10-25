<template>
  <SettingCard title="快照与诊断" icon="history">
    <div class="care pa-5">
      <v-tabs v-model="tab" color="primary" class="mb-5"><v-tab value="snapshots">本地快照</v-tab><v-tab value="diagnosis">启动诊断</v-tab></v-tabs>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
      <template v-if="tab === 'snapshots'">
        <p class="text-body-2 text-medium-emphasis mb-4">备份模组、配置和版本信息。安装或更新模组前会自动保留快照；相同内容只保存一份。</p>
        <div class="care-create"><v-text-field v-model="label" label="快照名称" placeholder="例如：安装光影之前" variant="outlined" density="compact" hide-details maxlength="80" /><v-btn color="primary" variant="flat" prepend-icon="add" :loading="busy" @click="create">创建快照</v-btn></div>
        <v-checkbox v-model="saves" label="同时备份这个实例的存档" density="compact" hide-details /><p class="text-caption text-medium-emphasis mb-4">请先退出游戏。共享链接目录会跳过并提示；快照仅保存在这台电脑。</p>
        <div class="d-flex align-center mb-3"><v-btn variant="text" size="small" @click="showTrash=!showTrash;refresh()">{{ showTrash ? '返回快照' : '回收站' }}</v-btn><v-btn v-if="showTrash && snapshots.length" variant="text" size="small" color="error" @click="purgeShown=true">清空回收站</v-btn><span class="text-caption text-medium-emphasis">{{ snapshots.length }} 个快照</span><v-spacer /><v-btn icon="refresh" size="small" variant="text" aria-label="刷新快照" :disabled="busy" @click="refresh" /></div>
        <div v-if="!snapshots.length" class="care-empty text-medium-emphasis">还没有快照。可以先为当前实例创建一个恢复点。</div>
        <article v-for="item in snapshots" :key="item.id" class="care-row"><div><strong>{{ item.label }}</strong><v-chip v-if="item.automatic" size="x-small" variant="tonal" class="ml-2">自动</v-chip><p>{{ new Date(item.created).toLocaleString() }} · {{ item.files }} 个文件 · {{ size(item.bytes) }}{{ item.includesSaves ? ' · 含存档' : '' }}</p><small v-for="warning in item.warnings" :key="warning">{{ warning }}</small></div><div class="d-flex ga-2"><v-btn v-if="!showTrash" variant="text" size="small" :disabled="busy" @click="trash(item)">移至回收站</v-btn><v-btn variant="tonal" size="small" :disabled="busy" @click="showTrash ? untrash(item) : selected = item">{{ showTrash ? '还原快照' : '恢复实例' }}</v-btn></div></article>
      </template>
      <template v-else>
        <div class="d-flex align-center flex-wrap ga-3 mb-4"><div><h3 class="text-subtitle-1">检查当前实例</h3><p class="text-caption text-medium-emphasis">在本机分析最近日志与启动配置，不上传日志。</p></div><v-spacer /><v-btn color="primary" variant="tonal" prepend-icon="troubleshoot" :loading="busy" @click="diagnose">开始检查</v-btn></div>
        <p v-if="!report" class="care-empty text-medium-emphasis">点击开始检查，查看 Java、内存、依赖和常见崩溃问题。</p>
        <template v-else><p class="text-caption text-medium-emphasis mb-4">检查于 {{ new Date(report.checked).toLocaleTimeString() }}{{ report.logAvailable ? '' : ' · 尚无最新游戏日志' }}</p><v-alert v-if="!issues.length" type="info" variant="tonal">没有发现规则能够确定的问题。仍无法启动时，可保留日志并继续排查。</v-alert><article v-for="issue in issues" :key="issue.id" class="care-row"><div><strong>{{ issue.title }}</strong><p>{{ issue.detail }}</p><code v-if="issue.evidence">{{ issue.evidence }}</code></div><v-btn v-if="issue.action" variant="tonal" size="small" @click="fix(issue.action)">{{ actionLabels[issue.action] }}</v-btn></article></template>
      </template>
    </div>
    <p v-if="storage" class="px-5 pb-4 text-caption text-medium-emphasis">本地快照占用 {{ size(storage.used) }} / {{ size(storage.limit) }} · 回收站 {{ storage.trashCount }} 项</p><v-dialog v-model="purgeShown" max-width="460"><v-card class="pa-6"><h2 class="text-h6 mb-3">永久清空回收站</h2><p class="text-body-2">将永久删除这个实例回收站中的快照，并清理不再被其它快照使用的内容文件。此操作无法撤销。</p><v-card-actions><v-spacer /><v-btn variant="text" @click="purgeShown=false">取消</v-btn><v-btn color="error" :loading="busy" @click="purge">永久清空</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="!!selected" max-width="480" @update:model-value="v => { if (!v) selected = undefined }"><v-card class="pa-6"><h2 class="text-h6 mb-3">恢复「{{ selected?.label }}」</h2><p class="text-body-2 text-medium-emphasis">将替换快照覆盖范围内的文件，之后新增的模组也会回退。恢复前会自动保存当前状态作为保护快照。{{ selected?.includesSaves ? '这份快照包含存档，存档进度也会回退。' : '这份快照不包含存档。' }}</p><v-card-actions class="pt-5 px-0"><v-spacer /><v-btn variant="text" :disabled="busy" @click="selected = undefined">取消</v-btn><v-btn color="primary" :loading="busy" @click="restore">确认恢复</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog v-model="repairShown" max-width="450"><v-card class="pa-6"><h2 class="text-h6 mb-3">检查并修复游戏文件</h2><p class="text-body-2 text-medium-emphasis">将先备份当前配置，再重新安装游戏版本 {{ versionHeader?.id }} 的运行文件。此操作可能需要下载文件。</p><v-card-actions><v-spacer /><v-btn variant="text" @click="repairShown = false">取消</v-btn><v-btn color="primary" :loading="busy" @click="repair">开始修复</v-btn></v-card-actions></v-card></v-dialog>
  </SettingCard>
</template>
<script setup lang="ts">
import SettingCard from '@/components/SettingCard.vue'
import { kInstance } from '@/composables/instance'
import { kInstanceVersion } from '@/composables/instanceVersion'
import { kInstanceJavaDiagnose } from '@/composables/instanceJavaDiagnose'
import { useService } from '@/composables/service'
import { useNotifier } from '@/composables/notifier'
import { injection } from '@/util/inject'
import { VersionInstallServiceKey } from '@xmcl/runtime-api'
import type { SnapshotSummary, CareIssue } from '../../../xmcl-electron-app/instanceCare'
const { path } = injection(kInstance), { versionHeader } = injection(kInstanceVersion), java = injection(kInstanceJavaDiagnose)
const { install } = useService(VersionInstallServiceKey), { notify } = useNotifier(), router = useRouter()
const tab = ref('snapshots'), label = ref(''), saves = ref(false), busy = ref(false), error = ref(''), snapshots = ref<SnapshotSummary[]>([]), selected = ref<SnapshotSummary>(), repairShown = ref(false)
const showTrash=ref(false),purgeShown=ref(false),storage=ref<{used:number;limit:number;trashCount:number}>()
const report = ref<{issues: CareIssue[]; checked:number; logAvailable:boolean}>()
const issues = computed(() => { const list = [...report.value?.issues || []]; if (java.issue.value && !list.some(i => i.action === 'java')) list.unshift({id:'java-current',title:'Java 运行时需要处理',detail:'当前实例尚未找到有效且兼容的 Java。',severity:'error',action:'java'}); return list })
const actionLabels = {java:'设置 Java',memory:'调整内存',repair:'修复游戏文件',mods:'检查模组',snapshots:'查看快照'}
const size = (b:number) => b >= 1024**3 ? (b/1024**3).toFixed(2)+' GB' : (b/1024**2).toFixed(1)+' MB'
async function perform(fn:()=>Promise<void>) { if (busy.value) return; busy.value=true;error.value='';try { if(typeof instanceCare==='undefined') throw new Error('请在桌面应用中使用此功能。');await fn() } catch(e) {error.value=e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'操作未完成，请重试。'}finally{busy.value=false} }
async function reloadList(){snapshots.value=await instanceCare.snapshots(path.value,showTrash.value);storage.value=await instanceCare.snapshotStorage(path.value)}
async function trash(item:SnapshotSummary){await perform(async()=>{await instanceCare.trashSnapshot(path.value,item.id);await reloadList()})}
async function untrash(item:SnapshotSummary){await perform(async()=>{await instanceCare.untrashSnapshot(path.value,item.id);await reloadList()})}
async function purge(){await perform(async()=>{await instanceCare.emptySnapshotTrash(path.value);purgeShown.value=false;await reloadList()})}
async function refresh() { await perform(async()=>{await reloadList()}) }
async function create() { await perform(async()=>{await instanceCare.snapshot(path.value,label.value||'手动快照',saves.value);label.value='';await reloadList();notify({title:'快照已保存',level:'success'})}) }
async function restore() { const item=selected.value;if(!item)return;await perform(async()=>{await instanceCare.restore(path.value,item.id);selected.value=undefined;await reloadList();notify({title:'实例已恢复，恢复前的状态已另存为快照',level:'success'})}) }
async function diagnose() {await perform(async()=>{report.value=await instanceCare.diagnose(path.value)})}
function fix(action: NonNullable<CareIssue['action']>) { if(action==='repair'){repairShown.value=true;return}if(action==='snapshots'){tab.value='snapshots';return}void router.push(action==='mods'?'/mods':'/base-setting?target=general') }
async function repair() {if(!versionHeader.value)return;await perform(async()=>{await instanceCare.snapshot(path.value,'修复游戏文件前',false);await install({type:'reinstall',version:versionHeader.value!.id,side:'client'});repairShown.value=false;notify({title:'游戏文件修复完成',level:'success'})})}
watch(path,()=>{report.value=undefined;void refresh()},{immediate:true})
</script>
<style scoped>
.care-create{display:flex;gap:12px;align-items:center}.care-create>.v-input{flex:1;min-width:0}.care-row{display:flex;gap:18px;align-items:center;justify-content:space-between;padding:18px 0;border-top:1px solid rgba(var(--v-theme-on-surface),.1)}.care-row>div{min-width:0}.care-row strong{font-size:14px;font-weight:500}.care-row p{font-size:12px;line-height:1.8;opacity:.65;margin:7px 0 0}.care-row small{display:block;font-size:11px;opacity:.7;margin-top:6px}.care-row code{display:block;font-size:11px;line-height:1.8;overflow-wrap:anywhere;margin-top:8px;opacity:.65}.care-empty{padding:26px 0;font-size:13px;line-height:1.8}.care :deep(.v-btn),.care :deep(.v-field){border-radius:var(--card-item-radius);letter-spacing:normal;text-transform:none}
</style>
