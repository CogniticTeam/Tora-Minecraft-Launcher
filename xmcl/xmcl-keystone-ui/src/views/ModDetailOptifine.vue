<script setup lang="ts">
import MarketProjectDetail, { ProjectDetail } from '@/components/MarketProjectDetail.vue'
import { ProjectVersion } from '@/components/MarketProjectDetailVersion.vue'
import { useService } from '@/composables'
import { kInstance } from '@/composables/instance'
import { useMarkdown } from '@/composables/markdown'
import { useProjectDetailEnable } from '@/composables/projectDetail'
import { kSWRVConfig } from '@/composables/swrvConfig'
import { useOptifineVersions } from '@/composables/version'
import { injection } from '@/util/inject'
import { ModFile } from '@/util/mod'
import { ProjectEntry } from '@/util/search'
import { getLoaderCompatibilityErrors, RuntimeVersions } from '@xmcl/instance'
import { InstanceModsServiceKey, InstanceServiceKey, VersionInstallServiceKey } from '@xmcl/runtime-api'
import useSWRV from 'swrv'

const props = defineProps<{
  mod: ProjectEntry<ModFile>
  runtime: RuntimeVersions
}>()

const { versions: optVersions, isValidating } = useOptifineVersions()

const selectedVersion = ref(undefined as ProjectVersion | undefined)
provide('selectedVersion', selectedVersion)

const { render: renderMd } = useMarkdown()
const { data: changelog, isValidating: loadingChangelog } = useSWRV(computed(() => selectedVersion.value && `https://www.optifine.net/changelog?f=OptiFine_${selectedVersion.value.id}.jar`), async (url) => {
  const res = await fetch(url)
  const text = await res.text()
  const [content] = text.split('\r\n\r\n')
  return renderMd(content)
}, inject(kSWRVConfig))

const versions = computed(() => {
  const files = optVersions.value
  const all: ProjectVersion[] = files.filter(f => (f.mcversion.endsWith('.0') ? f.mcversion.slice(0, f.mcversion.length - 2) : f.mcversion) === props.runtime.minecraft).map((f) => {
    const version = `${f.type}_${f.patch}`
    const id = `${f.mcversion}_${version}`
    const modVersion: ProjectVersion = reactive({
      id: props.mod.installed[0]?.version === version ? props.mod.installed[0].path : id,
      name: version,
      version,
      downloadCount: 0,
      installed: computed(() => {
        if (props.runtime.optifine === version) return true
        if (props.mod.installed.length > 0 && props.mod.installed[0].version === version) return true
        return false
      }),
      loaders: ['forge'],
      minecraftVersion: f.mcversion,
      type: 'release',
      disabled: getLoaderCompatibilityErrors({ ...props.runtime, optifine: version }, files).length > 0,
      changelog: computed(() => id === selectedVersion.value?.id ? changelog.value : undefined),
      changelogLoading: loadingChangelog,
    })
    return modVersion
  })
  return all.reverse()
})

selectedVersion.value = versions.value.find(v => v.installed) ?? versions.value[0]

const { data: optifineHome, isValidating: loadingDescription } = useSWRV('/optifine-home', async () => {
  const response = await fetch('https://www.optifine.net/home')
  const content = await response.text()
  const parsed = new DOMParser().parseFromString(content, 'text/html')
  const contentHTML = parsed.querySelector('.content')
  return contentHTML?.innerHTML || ''
}, inject(kSWRVConfig))
const _optifineHome = computed(() => optifineHome.value || props.mod.description)

const model = computed(() => {
  const result: ProjectDetail = reactive({
    id: props.mod.id,
    icon: props.mod.icon,
    title: props.mod.title,
    description: props.mod.description,
    categories: [],
    externals: [],
    info: [],
    galleries: [],
    author: props.mod.author,
    downloadCount: 0,
    follows: 0,
    url: 'https://www.optifine.net/home',
    htmlContent: _optifineHome,
    modLoaders: [],
    installed: computed(() => props.mod.installed.length > 0),
    enabled: false,
  })
  return result
})

const { editInstance } = useService(InstanceServiceKey)
const { install: installVersion } = useService(VersionInstallServiceKey)
const { path } = injection(kInstance)
const updating = ref(false)
const compatibilityErrors = computed(() => getLoaderCompatibilityErrors({ ...props.runtime, optifine: selectedVersion.value?.version || 'pending' }, optVersions.value))
const { uninstall: uninstallMod } = useService(InstanceModsServiceKey)
const onInstall = async (m: ProjectVersion) => {
  try {
    updating.value = true
    const instancePath = path.value
    const errors = getLoaderCompatibilityErrors({ ...props.runtime, optifine: m.version }, optVersions.value)
    if (errors.length) throw new Error(errors.join('\n'))
    const version = optVersions.value.find(v => `${v.type}_${v.patch}` === m.version && v.mcversion.replace(/\.0$/, '') === props.runtime.minecraft.replace(/\.0$/, ''))
    if (!version) throw new Error('找不到该 OptiFine 版本的兼容信息，请刷新后重试。')
    const deleteOld = hasInstalledVersion.value
    const oldFiles = props.mod.installed.map(i => i.path)
    await installVersion({ type: 'optifine-mod', options: { ...version, instancePath } })
    if (deleteOld) await uninstallMod({ path: instancePath, files: oldFiles })
  } finally {
    updating.value = false
  }
}

const onDelete = () => {
  if (props.runtime.optifine) {
    const newRuntime = { ...props.runtime, optifine: '' }
    editInstance({
      instancePath: path.value,
      runtime: newRuntime,
    })
  }

  if (props.mod.installed.length > 0) {
    uninstallMod({ path: path.value, files: props.mod.installed.map(i => i.path) })
  }
}
const { enabled, installed, hasInstalledVersion } = useProjectDetailEnable(
  selectedVersion,
  computed(() => props.mod.installed),
  updating,
  () => { },
  () => { },
)

</script>
<template>
  <div class="flex flex-col h-full">
  <v-alert v-if="compatibilityErrors.length" type="warning" variant="tonal" density="compact" class="ma-4 mb-0">
    {{ compatibilityErrors.join(' ') }}
  </v-alert>
  <MarketProjectDetail
    class="flex-1 min-h-0"
    :detail="model"
    :dependencies="[]"
    :enabled="enabled"
    :selected-installed="runtime.optifine === selectedVersion?.version || installed"
    :loading="loadingDescription"
    :versions="versions"
    :updating="updating"
    :disable-install="compatibilityErrors.length > 0"
    no-enabled
    :has-more="false"
    :loading-versions="isValidating"
    :loading-dependencies="false"
    @install="onInstall"
    @delete="onDelete"
  />
  </div>
</template>
