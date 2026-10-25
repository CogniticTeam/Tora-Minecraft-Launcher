<template>
  <div>
    <div class="text-sm font-bold opacity-70 my-4">主加载器</div>
    <div class="flex flex-wrap gap-3 mb-5 items-center justify-center" role="group" aria-label="主加载器（互斥）">
      <v-card v-for="loader in bases" :key="loader.id"
        :data-testid="`modloader-tab-${loader.id}`"
        :variant="currentBase === loader.id ? 'outlined' : 'tonal'"
        :color="currentBase === loader.id ? 'primary' : undefined"
        class="flex-1 min-w-[80px] max-w-[120px] flex flex-col items-center justify-center py-4 cursor-pointer transition-colors border-2"
        :style="{ borderColor: currentBase === loader.id ? 'rgb(var(--v-theme-primary))' : 'transparent' }"
        role="button" :aria-pressed="currentBase === loader.id" tabindex="0" data-gamepad-focusable
        @click="selectBase(loader.id)" @keydown.enter.prevent="selectBase(loader.id)" @keydown.space.prevent="selectBase(loader.id)">
        <img :src="loader.icon" :alt="loader.name" width="36" height="36" class="mb-2" />
        <span class="text-xs font-semibold">{{ loader.name }}</span>
      </v-card>
    </div>
    <p class="text-caption text-medium-emphasis mb-4">Forge、Fabric、Quilt、NeoForge 不能同时安装；附加组件可与兼容的主加载器组合。</p>
    <VersionInputMinecraft v-if="showMinecraft" data-testid="version-input-minecraft" class="mb-4"
      :value="data.runtime.minecraft" :versions="versions" @input="onSelectMinecraft" />
    <v-expand-transition>
      <div v-if="currentBase !== 'vanilla'">
        <VersionInputNeoForged v-if="currentBase === 'neoforge'" data-testid="version-input-neoforge"
          :value="data.runtime.neoForged" :minecraft="data.runtime.minecraft" :versions="versions"
          :auto-select-latest="autoSelectLatestOnClick" @input="onSelectNeoForged" />
        <VersionInputForge v-else-if="currentBase === 'forge'" data-testid="version-input-forge"
          :value="data.runtime.forge" :minecraft="data.runtime.minecraft" :versions="versions"
          :auto-select-latest="autoSelectLatestOnClick" @input="onSelectForge" />
        <VersionInputFabric v-else-if="currentBase === 'fabric'" data-testid="version-input-fabric"
          :value="data.runtime.fabricLoader" :minecraft="data.runtime.minecraft" :versions="versions"
          :auto-select-latest="autoSelectLatestOnClick" @input="onSelectFabric" />
        <VersionInputQuilt v-else-if="currentBase === 'quilt'" data-testid="version-input-quilt"
          :value="data.runtime.quiltLoader" :minecraft="data.runtime.minecraft" :versions="versions"
          :auto-select-latest="autoSelectLatestOnClick" @input="onSelectQuilt" />
      </div>
    </v-expand-transition>
    <div class="text-sm font-bold opacity-70 mt-5 mb-3">附加组件</div>
    <div class="flex flex-wrap gap-3 mb-3" role="group" aria-label="附加组件">
      <div :title="optifineHint">
        <v-card data-testid="modloader-tab-optifine" :disabled="!canOptifine"
          :variant="optifineEnabled ? 'outlined' : 'tonal'" :color="optifineEnabled ? 'primary' : undefined"
          class="px-4 py-3 flex items-center gap-3 border-2" :style="{ borderColor: optifineEnabled ? 'rgb(var(--v-theme-primary))' : 'transparent' }"
          role="checkbox" :aria-checked="optifineEnabled" :aria-disabled="!canOptifine" :tabindex="canOptifine ? 0 : -1"
          data-gamepad-focusable @click="toggleOptifine" @keydown.enter.prevent="toggleOptifine" @keydown.space.prevent="toggleOptifine">
          <img :src="BuiltinImages.optifine" alt="" width="28" height="28" />
          <div><div class="text-sm font-semibold">OptiFine</div><div class="text-caption text-medium-emphasis">需要兼容的 Forge</div></div>
          <v-icon size="18">{{ optifineEnabled ? 'check_box' : 'check_box_outline_blank' }}</v-icon>
        </v-card>
      </div>
      <div title="当前没有可验证的 Forge/Fabric 前置组合，暂不开放 LabyMod 组合安装。">
        <v-card data-testid="modloader-tab-labymod" disabled variant="tonal" class="px-4 py-3 flex items-center gap-3" aria-disabled="true">
          <img :src="BuiltinImages.labyMod" alt="" width="28" height="28" /><div><div class="text-sm">LabyMod</div><div class="text-caption">暂无可验证的前置组合</div></div>
        </v-card>
      </div>
    </div>
    <p v-if="!canOptifine" class="text-caption text-medium-emphasis mb-3">{{ optifineHint }}</p>
    <v-expand-transition>
      <div v-if="optifineEnabled">
        <VersionInputOptifine data-testid="version-input-optifine" :value="data.runtime.optifine"
          :forge="data.runtime.forge || ''" :minecraft="data.runtime.minecraft"
          :auto-select-latest="autoSelectLatestOnClick" @input="selectOptifine" />
        <p class="text-caption text-medium-emphasis mt-1" role="status" aria-live="polite">{{ matchingForge ? t('optifineVersion.matchingForge') : forgeMatchResult?.kind === 'adjusted' ? t('optifineVersion.forgeAdjusted', { from: forgeMatchResult.from, to: forgeMatchResult.to }) : t('optifineVersion.autoMatchHint') }}</p>
        <v-alert v-if="forgeMatchResult && forgeMatchResult.kind !== 'adjusted'" type="warning" variant="tonal" density="compact" class="mt-2">{{ t(forgeMatchResult.kind === 'failed' ? 'optifineVersion.forgeMatchFailed' : 'optifineVersion.forgeUnavailable') }}</v-alert>
      </div>
    </v-expand-transition>
    <v-alert v-if="errors.length" data-testid="modloader-compatibility-error" type="warning" variant="tonal" density="compact" class="mt-3">
      <div v-for="message in errors" :key="message">{{ message }}</div>
    </v-alert>
    <VersionInputLocal v-if="showLocal" class="mt-4" :value="data.version" :versions="versions"
      :placeholder="localPlaceholder" @input="onSelectLocalVersion" />
  </div>
</template>
<script lang="ts" setup>
import VersionInputFabric from '@/components/VersionInputFabric.vue'
import VersionInputForge from '@/components/VersionInputForge.vue'
import VersionInputLocal from '@/components/VersionInputLocal.vue'
import VersionInputMinecraft from '@/components/VersionInputMinecraft.vue'
import VersionInputNeoForged from '@/components/VersionInputNeoForged.vue'
import VersionInputOptifine from '@/components/VersionInputOptifine.vue'
import VersionInputQuilt from '@/components/VersionInputQuilt.vue'
import { useInstanceEditVersions } from '@/composables/instanceEdit'
import { useOptifineForgeSelection } from '@/composables/optifineForgeSelection'
import { useService } from '@/composables/service'
import { useOptifineVersions } from '@/composables/version'
import { BuiltinImages } from '@/constant'
import { getLoaderCompatibilityErrors, primaryLoaderKeys, type InstanceData } from '@xmcl/instance'
import { VersionMetadataServiceKey, type VersionHeader } from '@xmcl/runtime-api'
import { computed, ref, toRef, watch } from 'vue'
const props = withDefaults(defineProps<{
  data: Pick<InstanceData, 'runtime' | 'version'>
  versions: VersionHeader[]
  showMinecraft?: boolean
  showLocal?: boolean
  localPlaceholder?: string
  autoSelectLatestOnClick?: boolean
}>(), { showMinecraft: true, showLocal: true, localPlaceholder: undefined, autoSelectLatestOnClick: false })
const emit = defineEmits<{ (event: 'update:valid', valid: boolean): void }>()
const versions = toRef(props, 'versions')
const { onSelectMinecraft, onSelectNeoForged, onSelectForge, onSelectFabric, onSelectQuilt, onSelectOptifine, onSelectLocalVersion } = useInstanceEditVersions(props.data, versions)
const { versions: optifineVersions } = useOptifineVersions()
const { t } = useI18n()
const metadata = useService(VersionMetadataServiceKey)
const { select: selectOptifine, matching: matchingForge, result: forgeMatchResult } = useOptifineForgeSelection({
  data: props.data,
  selectOptifine: onSelectOptifine,
  selectForge: onSelectForge,
  getOptifineVersions: async () => optifineVersions.value.length ? optifineVersions.value : metadata.getOptifineVersions(),
  getForgeVersions: minecraft => metadata.getForgeVersions(minecraft),
})
const bases = [
  { id: 'vanilla', name: 'Vanilla', icon: BuiltinImages.minecraft },
  { id: 'forge', name: 'Forge', icon: BuiltinImages.forge },
  { id: 'fabric', name: 'Fabric', icon: BuiltinImages.fabric },
  { id: 'quilt', name: 'Quilt', icon: BuiltinImages.quilt },
  { id: 'neoforge', name: 'NeoForge', icon: BuiltinImages.neoForged },
]
const currentBase = ref('vanilla'), pendingBase = ref(false), optifineEnabled = ref(false)
const canOptifine = computed(() => !!props.data.runtime.forge && !props.data.runtime.fabricLoader && !props.data.runtime.quiltLoader && !props.data.runtime.neoForged && !props.data.runtime.labyMod)
const optifineHint = computed(() => canOptifine.value ? '将 OptiFine 作为 Forge 模组一起安装。' : '请先选择一个 Forge 版本。Fabric/Quilt 需要额外桥接组件；当前安装流程不支持这类 OptiFine 组合。')
const errors = computed(() => {
  const result = getLoaderCompatibilityErrors(props.data.runtime, optifineVersions.value)
  if (currentBase.value !== 'vanilla' && !primaryLoaderKeys.some(k => props.data.runtime[k])) result.push('请选择主加载器版本；没有可用版本时请更换 Minecraft 版本。')
  if (optifineEnabled.value && !props.data.runtime.optifine) result.push('请选择与当前 Forge 匹配的 OptiFine 版本，或取消 OptiFine。')
  return result
})
watch(errors, value => emit('update:valid', value.length === 0), { immediate: true })
watch(primaryLoaderKeys.map(key => () => props.data.runtime[key]), () => {
  const rt = props.data.runtime
  const base = rt.forge ? 'forge' : rt.fabricLoader ? 'fabric' : rt.quiltLoader ? 'quilt' : rt.neoForged ? 'neoforge' : undefined
  if (base) { currentBase.value = base; pendingBase.value = false }
  else if (!pendingBase.value) currentBase.value = 'vanilla'
}, { immediate: true })
watch(() => props.data.runtime.optifine, (value, old) => { if (value) optifineEnabled.value = true; else if (old) optifineEnabled.value = false }, { immediate: true })
watch(() => props.data.runtime, rt => {
  pendingBase.value = false
  currentBase.value = rt.forge ? 'forge' : rt.fabricLoader ? 'fabric' : rt.quiltLoader ? 'quilt' : rt.neoForged ? 'neoforge' : 'vanilla'
  optifineEnabled.value = !!rt.optifine
})
watch(() => props.data.runtime.minecraft, () => {
  if (!primaryLoaderKeys.some(key => props.data.runtime[key])) { currentBase.value = 'vanilla'; pendingBase.value = false }
  if (!props.data.runtime.optifine) optifineEnabled.value = false
})
function selectBase(id: string) {
  const next = currentBase.value === id ? 'vanilla' : id
  for (const key of primaryLoaderKeys) props.data.runtime[key] = ''
  props.data.runtime.optifine = ''; props.data.runtime.labyMod = ''; props.data.version = ''
  optifineEnabled.value = false; currentBase.value = next; pendingBase.value = next !== 'vanilla'
}
function toggleOptifine() {
  if (!canOptifine.value) return
  optifineEnabled.value = !optifineEnabled.value
  if (!optifineEnabled.value) props.data.runtime.optifine = ''
}
</script>
