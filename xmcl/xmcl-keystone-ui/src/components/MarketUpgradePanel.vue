<template>
  <div class="filter-subheader">
    <v-icon size="16" class="mr-1">upgrade</v-icon>
    {{ t('shared.checkUpgrade') }}
  </div>
  <SettingItem
    :title="t('modUpgradePolicy.name')"
    :description="t(`modUpgradePolicy.${upgradePolicy}`)"
  >
    <template #action>
      <v-btn-toggle
        v-roving-tabindex
        :model-value="upgradePolicy"
        :aria-label="t('modUpgradePolicy.name')"
        density="compact"
        mandatory
        color="primary"
        @update:model-value="emit('update:upgradePolicy', $event)"
      >
        <v-btn
          v-shared-tooltip="'Modrinth > Curseforge'"
          value="modrinth"
          size="small"
          variant="text"
          border
        >
          <v-icon size="small">xmcl:modrinth</v-icon>
          <v-icon size="small">xmcl:curseforge</v-icon>
        </v-btn>
        <v-btn
          v-shared-tooltip="'Curseforge > Modrinth'"
          value="curseforge"
          size="small"
          variant="text"
          border
        >
          <v-icon size="small">xmcl:curseforge</v-icon>
          <v-icon size="small">xmcl:modrinth</v-icon>
        </v-btn>

        <v-btn
          v-shared-tooltip="'Modrinth'"
          value="modrinthOnly"
          size="small"
          variant="text"
          border
        >
          <v-icon size="small">xmcl:modrinth</v-icon>
        </v-btn>

        <v-btn
          v-shared-tooltip="'Curseforge'"
          value="curseforgeOnly"
          size="small"
          variant="text"
          border
        >
          <v-icon size="small">xmcl:curseforge</v-icon>
        </v-btn>
      </v-btn-toggle>
    </template>
  </SettingItem>
  <slot name="extra" />
  <SettingItem>
    <template #action>
      <div class="flex gap-1">
        <v-btn :loading="refreshing" size="large" variant="text" @click="emit('check-upgrade')">
          <v-icon start> refresh </v-icon>
          {{ t('shared.checkUpgrade') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          :loading="upgrading"
          :disabled="Object.keys(plans).length === 0"
          size="large"
          @click="openPreview"
        >
          <v-icon start> upgrade </v-icon>
          预览更新
        </v-btn>
      </div>
    </template>
  </SettingItem>
  <v-dialog v-model="preview" max-width="780">
    <v-card class="pa-6">
      <h2 class="text-h6 mb-2">更新预览</h2>
      <p class="text-caption text-medium-emphasis mb-4">选择要更新的内容。应用前会创建本地快照，未选中的项目保持当前版本。</p>
      <div style="max-height:55vh;overflow:auto">
        <article v-for="item in previewItems" :key="item.id" class="upgrade-preview-row">
          <v-checkbox v-model="selected" :value="item.id" :disabled="!item.compatible" hide-details density="compact" :label="item.name" />
          <div class="pl-9 text-caption text-medium-emphasis">
            <p>{{ item.from }} → {{ item.to }}</p>
            <p v-if="!item.compatible" class="text-error">不适用于当前 Minecraft 版本</p>
            <p v-if="item.dependencies">必需依赖：{{ item.dependencies }} 项，提交时会检查是否已安装或同时选中。</p>
            <details v-if="item.changelog"><summary>更新说明</summary><pre style="white-space:pre-wrap;font:inherit;max-height:150px;overflow:auto">{{ item.changelog }}</pre></details>
          </div>
        </article>
      </div>
      <v-card-actions class="px-0 pt-5">
        <v-btn variant="text" @click="selected = previewItems.filter(i => i.compatible).map(i => i.id)">全选兼容更新</v-btn>
        <v-spacer /><v-btn variant="text" @click="preview = false">取消</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!selected.length" @click="confirmPreview">更新 {{ selected.length }} 项</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { vRovingTabindex } from '@/directives/rovingTabindex'
import { vSharedTooltip } from '@/directives/sharedTooltip'
import SettingItem from './SettingItem.vue'
import { kInstance } from '@/composables/instance'
import type { UpgradePlan } from '@/composables/modUpgrade'

const props = defineProps<{
  plans: Record<string, unknown>
  upgradePolicy: 'modrinth' | 'curseforge' | 'curseforgeOnly' | 'modrinthOnly'
  refreshing?: boolean
  upgrading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:upgradePolicy', value: 'modrinth' | 'curseforge' | 'curseforgeOnly' | 'modrinthOnly'): void
  (e: 'check-upgrade'): void
  (e: 'upgrade', selected: string[]): void
}>()

const { t } = useI18n()
const context = inject(kInstance, undefined)
const preview = ref(false), selected = ref<string[]>([])
const previewItems = computed(() => Object.entries(props.plans).map(([id, value]) => {
  const p = value as UpgradePlan
  const v = 'version' in p ? p.version : undefined, f = 'file' in p ? p.file : undefined
  const minecraft = context?.runtime.value.minecraft
  return { id, name: p.mod.fileName || p.filePath, from: p.mod.fileName, to: v?.version_number || f?.displayName || '新版本', compatible: !minecraft || (v ? v.game_versions.includes(minecraft) : !!f?.gameVersions.includes(minecraft)), dependencies: v?.dependencies.filter(d => d.dependency_type === 'required').length || f?.dependencies.filter(d => d.relationType === 3).length || 0, changelog: v?.changelog?.slice(0, 10000) || '' }
}))
function openPreview() { selected.value = previewItems.value.filter(i => i.compatible).map(i => i.id); preview.value = true }
function confirmPreview() { const ids = selected.value.filter(id => previewItems.value.some(i => i.id === id && i.compatible)); if (!ids.length) return; emit('upgrade', ids); preview.value = false }
</script>

<style scoped>
.upgrade-preview-row{padding:12px 0;border-bottom:1px solid rgba(var(--v-theme-on-surface),.1)}.upgrade-preview-row details{margin-top:7px}.upgrade-preview-row summary{cursor:pointer}
</style>
