<template>
  <div class="terracotta-page" data-testid="terracotta-page">
    <header class="terracotta-header">
      <div><v-icon color="primary" :size="24">lan</v-icon><h1>{{ t('customDownload.multiplayer') }}</h1></div>
      <v-menu location="bottom end"><template #activator="{ props }"><v-btn v-bind="props" icon="more_horiz" variant="text" aria-label="联机菜单" /></template><v-list density="compact"><v-list-item title="陶瓦项目主页" prepend-icon="open_in_new" @click="openProject" /><v-list-item title="重新连接组件" prepend-icon="refresh" :disabled="busy" @click="run('prepare')" /></v-list></v-menu>
    </header>
    <div class="terracotta-content">
      <section class="terracotta-intro"><div><span class="terracotta-eyebrow">与朋友共享一个世界</span><h2>从局域网，到你的朋友。</h2><p>创建房间并分享房间码，或加入朋友已经开放的存档。</p></div><div class="terracotta-player"><PlayerAvatar :src="gameProfile?.textures?.SKIN?.url" :dimension="36" /><div><strong>{{ player }}</strong><span>当前游戏档案</span></div></div></section>
      <div v-if="error || snapshot.error" role="alert" class="terracotta-error"><v-icon :size="19">error_outline</v-icon><span>{{ error || snapshot.error }}</span><v-btn v-if="snapshot.phase === 'error'" variant="text" size="small" :disabled="busy" @click="run('prepare')">重试</v-btn></div>
      <Transition name="fade-transition" mode="out-in">
        <section v-if="active" key="room" class="terracotta-panel">
          <div class="terracotta-section-title"><div><span class="terracotta-eyebrow">{{ snapshot.state.startsWith('host') ? '我的房间' : '朋友的房间' }}</span><h3>{{ stateTitle }}</h3></div><v-btn variant="text" prepend-icon="logout" :loading="busy" @click="run('leave')">退出房间</v-btn></div>
          <v-progress-linear v-if="!connected" indeterminate color="primary" class="mb-6" />
          <p class="terracotta-description">{{ stateDescription }}</p><p v-if="snapshot.transport === 'relay'" class="terracotta-hint">已通过 TMCL 中国服务器中继连接。请使用下方直连地址加入游戏。</p><p v-else-if="snapshot.relayAvailable" class="terracotta-hint">TMCL 中继备用通道已就绪，朋友无法直连时将自动使用。</p>
          <div v-if="connected" class="d-flex flex-wrap ga-3 mt-4 text-caption"><v-chip size="small" variant="tonal">{{ snapshot.transport === 'relay' ? 'TMCL 中继' : snapshot.transport === 'direct' ? '原生直连' : '房主 · 自动选路' }}</v-chip><span v-if="snapshot.relayLatencyMs !== undefined">中继节点往返 {{ snapshot.relayLatencyMs }} ms</span><span v-if="snapshot.gameLatencyMs !== undefined">游戏状态延迟 {{ snapshot.gameLatencyMs }} ms</span><span v-else-if="snapshot.state === 'guest-ok'" class="text-medium-emphasis">尚未获得游戏延迟结果</span></div>
          <div v-if="snapshot.room" class="terracotta-code"><div><span>房间码</span><code>{{ snapshot.room }}</code></div><v-btn variant="tonal" prepend-icon="content_copy" @click="copy(snapshot.room!)">复制房间码</v-btn></div>
          <div v-if="snapshot.address" class="terracotta-code"><div><span>游戏直连地址</span><code>{{ snapshot.address }}</code></div><v-btn variant="tonal" prepend-icon="content_copy" @click="copy(snapshot.address!)">复制地址</v-btn></div>
          <div v-if="snapshot.profiles.length" class="terracotta-members"><h4>房间成员 <span>{{ snapshot.profiles.length }}</span></h4><div v-for="(member, index) in snapshot.profiles" :key="index" class="terracotta-member"><v-icon :size="20">person_outline</v-icon><strong>{{ member.name }}</strong><span>{{ member.kind === 'HOST' ? '房主' : member.kind === 'LOCAL' ? '我' : '玩家' }}</span></div></div>
          <p v-if="snapshot.state === 'host-scanning'" class="terracotta-hint">在 Minecraft 中进入单人存档 → 暂停菜单 → 对局域网开放。启动器会自动发现游戏，无需填写端口。</p>
        </section>
        <section v-else key="entry" class="terracotta-panel">
          <v-tabs v-model="mode" color="primary" class="terracotta-tabs"><v-tab value="host">创建房间</v-tab><v-tab value="join">加入房间</v-tab></v-tabs>
          <div class="terracotta-entry">
            <template v-if="mode === 'host'"><div class="terracotta-section-title"><div><h3>让朋友加入你的存档</h3><p>进入游戏并对局域网开放，陶瓦会自动寻找它。</p></div><v-icon :size="38" class="terracotta-block">public</v-icon></div><ol class="terracotta-steps"><li><span>1</span><div><strong>打开你的 Minecraft 世界</strong><p>房间内玩家需使用相同的游戏版本和模组。</p></div></li><li><span>2</span><div><strong>在游戏中「对局域网开放」</strong><p>可在创建房间之前或之后完成。</p></div></li><li><span>3</span><div><strong>将房间码分享给朋友</strong><p>等待朋友加入后，在同一个世界相遇。</p></div></li></ol><div class="terracotta-actions"><span>{{ componentHint }}</span><v-btn color="primary" variant="flat" prepend-icon="add" :loading="busy" @click="run('host')">创建房间</v-btn></div></template>
            <form v-else @submit.prevent="run('join')"><div class="terracotta-section-title"><div><h3>带着房间码，去见朋友</h3><p>让房主复制完整房间码并发送给你。</p></div></div><v-text-field v-model="room" label="陶瓦房间码" placeholder="U/XXXX-XXXX-XXXX-XXXX" variant="outlined" density="comfortable" maxlength="64" autocomplete="off" spellcheck="false" :disabled="busy" hide-details="auto" /><p class="terracotta-hint">连接后，打开 Minecraft 多人游戏，房间会出现在局域网列表中。也可以复制连接成功后显示的直连地址。</p><div class="terracotta-actions"><span>{{ componentHint }}</span><v-btn type="submit" color="primary" variant="flat" prepend-icon="login" :disabled="!room.trim()" :loading="busy">加入房间</v-btn></div></form>
          </div>
        </section>
      </Transition>
      <footer class="terracotta-footer"><span>由 Terracotta {{ snapshot.version }} · EasyTier 提供联机能力</span></footer>
    </div>
    <v-dialog v-model="environmentShown" max-width="760"><v-card class="pa-6"><h2 class="text-h6 mb-3">加入前环境检查</h2><v-alert v-if="environmentResult?.warning" type="warning" variant="tonal" class="mb-4">{{ environmentResult.warning }}仍可尝试连接，但无法确认版本和模组是否兼容。</v-alert><p v-else-if="!environmentResult?.differences.length" class="text-body-2 mb-4">游戏版本、加载器与模组文件一致。</p><p v-if="environmentResult?.differences.length" class="text-body-2 text-medium-emphasis mb-4">发现 {{ environmentResult.differences.length }} 项差异。图形等纯客户端模组可能允许不同，其它差异请先确认。</p><div style="max-height:45vh;overflow:auto"><article v-for="item in environmentResult?.differences" :key="item.kind+item.name" class="environment-difference"><strong>{{ item.name }}</strong><span>本机：{{ item.local }} · 房主：{{ item.remote }}</span></article></div><v-card-actions class="px-0 pt-5"><v-btn variant="text" @click="environmentShown=false">返回调整实例</v-btn><v-spacer /><v-btn color="primary" variant="flat" :disabled="!!environmentResult?.differences.some(d=>d.kind==='game')" :loading="busy" @click="joinChecked">{{ environmentResult?.warning || environmentResult?.differences.length ? '确认差异并加入' : '加入房间' }}</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<script setup lang="ts">
import PlayerAvatar from '@/components/PlayerAvatar.vue'
import { kUserContext } from '@/composables/user'
import { kInstances } from '@/composables/instances'
import { useNotifier } from '@/composables/notifier'
import { injection } from '@/util/inject'
import type { TerracottaSnapshot } from '../../../xmcl-electron-app/terracotta'
const { t } = useI18n()
const { gameProfile, userProfile } = injection(kUserContext)
const { notify } = useNotifier()
const { selectedInstance } = injection(kInstances)
const instancePath = computed(() => selectedInstance.value)
const environmentShown = ref(false)
const environmentResult = ref<Awaited<ReturnType<typeof terracottaClient.inspect>>>()
const player = computed(() => gameProfile.value?.name || userProfile.value?.username || 'TMCL 玩家')
const snapshot = ref<TerracottaSnapshot>({ phase: 'missing', state: 'waiting', index: -1, version: '0.4.2', profiles: [] })
const busy = ref(false), error = ref(''), room = ref(''), mode = ref('host')
const active = computed(() => snapshot.value.phase === 'ready' && !['waiting', 'exception'].includes(snapshot.value.state))
const connected = computed(() => ['host-ok', 'guest-ok'].includes(snapshot.value.state))
const stateTitle = computed(() => ({ 'host-scanning': '正在寻找局域网世界', 'host-starting': '正在创建房间', 'host-ok': '房间已开放', 'guest-connecting': '正在连接房主', 'guest-starting': '正在建立联机网络', 'guest-ok': '已加入房间' }[snapshot.value.state] || '正在连接'))
const stateDescription = computed(() => snapshot.value.transport === 'relay' ? '在 Minecraft 多人游戏中选择「直接连接」，填入下方地址即可加入。' : ({ 'host-scanning': '请保持游戏运行，并将存档对局域网开放。', 'host-starting': '正在准备网络，房间码已生成。', 'host-ok': '将下方房间码发送给朋友，保持存档和启动器运行。', 'guest-connecting': '正在寻找房主，请确认房主仍在游戏中。', 'guest-starting': '正在尝试直连，复杂网络环境可能需要更长时间。', 'guest-ok': '打开游戏的多人游戏页面，选择发现的局域网世界，或使用下方地址直连。' }[snapshot.value.state] || ''))
const componentHint = computed(() => busy.value ? '正在准备联机组件…' : snapshot.value.phase === 'ready' ? '联机组件已就绪' : '首次使用会自动下载官方联机组件')
let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
async function poll() {
  try { if (typeof terracottaClient !== 'undefined') snapshot.value = await terracottaClient.status() } catch { /* active operations show actionable errors */ }
  if (!stopped) timer = setTimeout(poll, active.value || busy.value ? 800 : 2500)
}
async function run(action: 'prepare' | 'host' | 'join' | 'leave') {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    if (typeof terracottaClient === 'undefined') throw new Error('请在桌面启动器中使用联机功能。')
    if(action==='join'){environmentResult.value=await terracottaClient.inspect(room.value,instancePath.value||undefined);environmentShown.value=true;return}
    snapshot.value = action === 'host' ? await terracottaClient.host(player.value,instancePath.value||undefined) : await terracottaClient[action]()
  } catch (e) { error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '联机操作失败，请重试。' }
  finally { busy.value = false }
}
async function joinChecked(){if(busy.value)return;busy.value=true;error.value='';try{snapshot.value=await terracottaClient.join(room.value,player.value);environmentShown.value=false}catch(e){error.value=e instanceof Error?e.message:'无法加入房间。'}finally{busy.value=false}}
function copy(text: string) { windowController.writeClipboard(text); notify({ title: '已复制', level: 'success' }) }
function openProject() { window.open('https://github.com/burningtnt/Terracotta', '_blank') }
watch([mode, room], () => { error.value = '' })
onMounted(()=>{document.title=`TORA Minecraft Launcher - ${t('customDownload.multiplayer')}`;void poll()})
onUnmounted(() => { stopped = true; clearTimeout(timer) })
</script>

<style scoped>.environment-difference{display:flex;flex-direction:column;gap:6px;padding:13px 0;border-bottom:1px solid rgba(var(--v-theme-on-surface),.1);font-size:13px;overflow-wrap:anywhere}.environment-difference span{font-size:12px;opacity:.65}</style>

<style scoped>
.terracotta-page{display:flex;flex-direction:column;min-height:0;flex:1;color:rgb(var(--v-theme-on-surface));--tc-line:rgba(var(--v-theme-on-surface),.1);--tc-muted:rgba(var(--v-theme-on-surface),.6)}
.terracotta-header{display:flex;align-items:center;justify-content:space-between;padding:22px 30px 18px;flex-shrink:0}.terracotta-header>div{display:flex;align-items:center;gap:12px}.terracotta-header h1{font-size:22px;font-weight:600}.terracotta-content{padding:14px 30px 30px;overflow:auto;max-width:1120px;width:100%;margin:0 auto}.terracotta-intro{display:flex;justify-content:space-between;gap:24px;align-items:center;margin:12px 0 28px}.terracotta-eyebrow{font-size:12px;color:var(--tc-muted);display:block;margin-bottom:8px}.terracotta-intro h2{font-size:28px;letter-spacing:-.5px;font-weight:600;line-height:1.4}.terracotta-intro p,.terracotta-section-title p,.terracotta-description{font-size:14px;color:var(--tc-muted);line-height:1.8;margin:10px 0 0}.terracotta-player{display:flex;gap:12px;align-items:center;flex-shrink:0}.terracotta-player strong,.terracotta-player span{display:block;font-size:13px}.terracotta-player span{font-size:11px;color:var(--tc-muted);margin-top:3px}.terracotta-panel{border:1px solid var(--tc-line);border-radius:var(--surface-card-radius,18px);background:rgb(var(--v-theme-surface));padding:26px}.terracotta-tabs{border-bottom:1px solid var(--tc-line);margin:-10px -2px 24px}.terracotta-tabs :deep(.v-tab){text-transform:none;letter-spacing:normal}.terracotta-section-title{display:flex;justify-content:space-between;align-items:center;gap:16px}.terracotta-section-title h3{font-size:20px;font-weight:600}.terracotta-block{opacity:.25}.terracotta-steps{list-style:none;margin:26px 0;padding:0;display:grid;gap:22px}.terracotta-steps li{display:flex;gap:16px;align-items:flex-start}.terracotta-steps li>span{width:28px;height:28px;border-radius:var(--card-item-radius,8px);background:rgba(var(--v-theme-on-surface),.055);display:grid;place-items:center;font-size:12px;flex-shrink:0}.terracotta-steps strong{font-size:14px;font-weight:500}.terracotta-steps p{font-size:12px;color:var(--tc-muted);margin:5px 0 0;line-height:1.7}.terracotta-actions{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:26px;padding-top:20px;border-top:1px solid var(--tc-line)}.terracotta-actions>span{font-size:12px;color:var(--tc-muted)}.terracotta-page :deep(.v-btn){text-transform:none;letter-spacing:normal;border-radius:var(--card-item-radius,10px)}.terracotta-page :deep(.v-field){border-radius:var(--card-item-radius,10px);font-size:14px}.terracotta-entry form>.v-input{margin-top:28px}.terracotta-hint{font-size:13px;color:var(--tc-muted);line-height:1.9;margin:20px 0 0}.terracotta-code{display:flex;align-items:center;justify-content:space-between;gap:18px;background:rgba(var(--v-theme-on-surface),.04);border-radius:var(--card-item-radius,12px);padding:20px;margin-top:24px}.terracotta-code span{display:block;font-size:12px;color:var(--tc-muted);margin-bottom:8px}.terracotta-code code{font-family:ui-monospace,monospace;font-size:21px;letter-spacing:.5px;overflow-wrap:anywhere}.terracotta-members{margin-top:28px}.terracotta-members h4{font-weight:500;font-size:14px;padding-bottom:14px;border-bottom:1px solid var(--tc-line)}.terracotta-members h4 span{font-size:12px;color:var(--tc-muted);margin-left:7px}.terracotta-member{display:flex;gap:12px;align-items:center;padding:13px 0;border-bottom:1px solid var(--tc-line);font-size:13px}.terracotta-member strong{font-weight:500;flex:1}.terracotta-member>span{font-size:12px;color:var(--tc-muted)}.terracotta-footer{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--tc-muted);margin-top:20px;flex-wrap:wrap}.terracotta-error{display:flex;align-items:center;gap:12px;font-size:13px;line-height:1.7;border:1px solid rgba(var(--v-theme-error),.18);background:rgba(var(--v-theme-error),.06);border-radius:var(--card-item-radius,10px);padding:12px 16px;margin-bottom:18px}.terracotta-error>span{flex:1}@media(max-width:1000px){.terracotta-intro{align-items:flex-start}.terracotta-intro h2{font-size:24px}.terracotta-content{padding:10px 22px 24px}.terracotta-panel{padding:22px}.terracotta-code{align-items:flex-start;flex-direction:column}.terracotta-code code{font-size:18px}}
</style>
