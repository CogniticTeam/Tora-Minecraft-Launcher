<template>
  <SettingCard
    v-if="!disableUpdate"
    :title="t('setting.update')"
    icon="rocket_launch"
  >
    <div class="px-5 pt-4"><v-select v-model="channel" :items="[{title:'稳定版',value:'stable'},{title:'测试版（含预发布版本）',value:'beta'}]" label="更新通道" variant="outlined" density="compact" hide-details :disabled="checkingUpdate || downloadingUpdate || installing" @update:model-value="changeChannel" /><v-alert v-if="updateError" type="error" variant="tonal" class="mt-3">{{ updateError }}</v-alert><v-alert v-if="previousUpdate" :type="previousUpdate.state === 'installed' ? 'info' : 'warning'" variant="tonal" class="mt-3">{{ previousUpdate.message }}</v-alert></div>
    <v-progress-linear v-if="!updateStateReady" indeterminate />
    <template v-else-if="updateUnavailable && manualCheckSupported">
      <div class="px-5 py-4">
        <div class="text-body-1 font-medium">当前版本 v{{ version }}</div>
        <p class="text-body-2 text-medium-emphasis mt-2">{{ checkingUpdate ? '正在检查 TORA 更新…' : updateInfo?.newUpdate ? `发现新版本 v${updateInfo.name}，可下载安装包更新。` : manualCheckRequested ? '当前没有适用于本机的新版本。' : '检查由 TORA 发布的启动器版本。' }}</p>
        <p v-if="updateInfo?.newUpdate" class="text-body-2 mt-3" style="white-space:pre-wrap">{{ updateInfo.body }}</p>
        <div class="flex gap-2 mt-4"><v-btn color="primary" variant="tonal" :loading="checkingUpdate" @click="checkUpdate">检查更新</v-btn><v-btn :variant="updateInfo?.newUpdate ? 'flat' : 'text'" color="primary" @click="openReleases">{{ updateInfo?.newUpdate ? '下载更新' : '下载页面' }}</v-btn></div>
      </div>
    </template>
    <template v-else-if="updateUnavailable">
      <v-alert type="info" variant="tonal" class="ma-4" role="status">
        <strong>{{ t('launcherUpdate.automaticUnavailable') }}</strong>
        <div>{{ t(updateCapabilityReason === 'not-configured' ? 'launcherUpdate.automaticNotConfigured' : 'launcherUpdate.automaticNotImplemented') }}</div>
        <div>{{ t('launcherUpdate.manualCheckHint') }}</div>
        <div v-if="manualCheckRequested">{{ t('launcherUpdate.manualCheckRequired') }}</div>
      </v-alert>
      <div class="flex gap-2 px-4 pb-4">
        <v-btn variant="text" :loading="checkingUpdate" @click="checkUpdate">
          {{ t('setting.checkUpdate') }}
        </v-btn>
        <v-btn variant="text" @click="openReleases">
          {{ t('setting.githubRelease') }}
        </v-btn>
      </div>
    </template>
    <SettingItem v-else>
      <template #preaction>
        <v-btn
          data-testid="settings-check-update"
          v-shared-tooltip="() => t('setting.checkUpdate')"
          icon
          variant="text"
          :loading="checkingUpdate"
          @click="checkUpdate"
        >
          <v-icon>refresh</v-icon>
        </v-btn>
      </template>
      
      <template #title>
        {{ t("setting.latestVersion") }}
      </template>

      <template #subtitle>
        <span :class="{'success--text': !hasNewUpdate, 'primary--text': hasNewUpdate}">
          v{{ version }}
          {{ hasNewUpdate && updateInfo ? `-> ${updateInfo.name}` : "" }}
        </span>
        <v-chip
          v-if="hasNewUpdate"
          size="x-small"
          color="primary"
          class="ml-2"
          label
        >
          NEW
        </v-chip>
      </template>
      
      <template #action>
        <v-btn
          :loading="checkingUpdate || installing"
          :disabled="updateStatus === 'none'"
          :color="updateStatus !== 'none' ? 'primary' : ''"
          :outlined="updateStatus === 'none'"
          @click="showUpdateInfo()"
         size="small">
          <v-icon start size="small" v-if="updateStatus !== 'none'">system_update</v-icon>
          {{
            updateStatus === "none"
              ? t("launcherUpdate.alreadyLatest")
              : updateStatus === "pending"
                ? t("launcherUpdate.updateToThisVersion")
                : t("launcherUpdate.installAndQuit")
          }}
        </v-btn>
      </template>
    </SettingItem>
  </SettingCard>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { vSharedTooltip } from '@/directives/sharedTooltip'
import { injection } from '@/util/inject'
import { useDialog } from '../composables/dialog'
import { kUpdateSettings } from '../composables/setting'
import SettingCard from '@/components/SettingCard.vue'
import SettingItem from '@/components/SettingItem.vue'

const { show: showUpdateInfo } = useDialog('update-info')
const disableUpdate = false // state.env !== 'raw'
function openReleases() {
  window.open('https://154.8.230.216/downloads', 'browser')
}
const { updateInfo, installing, downloadingUpdate, updateStatus, checkUpdate, checkingUpdate, version, updateStateReady, updateUnavailable, updateCapabilityReason, manualCheckRequested, manualCheckSupported } = injection(kUpdateSettings)
const channel=ref('stable'),updateError=ref(''),previousUpdate=ref<{state:string;message:string}>()
onMounted(async()=>{if(typeof launcherUpdates==='undefined')return;try{const p=await launcherUpdates.preferences();channel.value=p.channel;previousUpdate.value=p.status}catch{/* initial preferences do not block settings */}})
async function changeChannel(){if(typeof launcherUpdates==='undefined')return;updateError.value='';try{await launcherUpdates.setChannel(channel.value);await checkUpdate()}catch(e){updateError.value=e instanceof Error?e.message:'更新检查失败，请重试。'}}
const hasNewUpdate = computed(() => updateStatus.value !== 'none' && !!updateInfo.value?.newUpdate)
const { t } = useI18n()

</script>

<style scoped>
:deep(.transparent-list) {
  background: transparent !important;
}

.v-card {
  transition: all 0.2s ease;
}

.v-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
</style>
