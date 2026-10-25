<template>
  <SettingCard :title="t('toolbox.title')" icon="construction" class="mb-5" data-testid="misc-toolbox">
    <v-tabs v-model="category" color="primary" density="compact" show-arrows class="toolbox-tabs" :aria-label="t('toolbox.categoriesLabel')">
      <v-tab v-for="group in toolboxCategories" :key="group.id" :value="group.id">{{ t('toolbox.categories.' + group.id) }}</v-tab>
    </v-tabs>
    <Transition name="fade-transition" mode="out-in">
      <div :key="category" class="toolbox-grid mt-4" role="group" :aria-label="t('toolbox.categories.' + category)">
        <v-btn v-for="tool in links" :key="tool.id" :href="tool.href" target="browser" rel="noopener noreferrer" :title="tool.href" variant="text" class="toolbox-link" :aria-label="tool.name" :data-tool="tool.id">
          <span class="toolbox-icon"><CurseforgeIcon v-if="tool.id === 'curseforge'" /><img v-else-if="icons[tool.id] && !failed.has(tool.id)" :src="icons[tool.id]" alt="" width="28" height="28" @error="failed.add(tool.id)"><v-icon v-else :size="24">{{ tool.fallback }}</v-icon></span>
          <span class="toolbox-label"><strong>{{ tool.name }}</strong><span>{{ host(tool.href) }}</span></span>
          <v-icon :size="15" class="toolbox-external">open_in_new</v-icon>
        </v-btn>
      </div>
    </Transition>
  </SettingCard>
</template>

<script lang="ts" setup>
import SettingCard from './SettingCard.vue'
import CurseforgeIcon from './CurseforgeIcon.vue'
import { toolboxCategories } from '@/util/toolbox'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const category = ref(toolboxCategories[0].id)
const failed = ref(new Set<string>())
const assets = import.meta.glob<string>('../assets/toolbox/*.{png,ico,svg,webp,jpg,gif}', { eager: true, query: '?url', import: 'default' })
const icons = Object.fromEntries(Object.entries(assets).map(([path, url]) => [path.split('/').at(-1)!.replace(/\.[^.]+$/, ''), url]))
const links = computed(() => toolboxCategories.find(group => group.id === category.value)?.links || [])
function host(url: string) { return new URL(url).hostname.replace(/^www\./, '') }
</script>

<style scoped>
.toolbox-tabs{border-bottom:1px solid rgba(var(--v-theme-on-surface),.09)}
.toolbox-tabs :deep(.v-tab){text-transform:none;letter-spacing:normal;font-size:13px;min-width:0}
.toolbox-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:8px}
.toolbox-link{height:72px!important;min-width:0;padding:10px 12px!important;justify-content:flex-start;letter-spacing:normal;text-transform:none;border-radius:var(--card-item-radius,10px)}
.toolbox-link :deep(.v-btn__content){width:100%;gap:12px;justify-content:flex-start;min-width:0}
.toolbox-icon{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;border-radius:var(--card-item-radius,10px);background:rgba(var(--v-theme-on-surface),.045)}
.toolbox-icon img{object-fit:contain;border-radius:3px}
.toolbox-icon :deep(svg){width:28px;height:28px}
.toolbox-label{min-width:0;flex:1;text-align:left;line-height:1.45}.toolbox-label strong,.toolbox-label>span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.toolbox-label strong{font-size:13px;font-weight:500}.toolbox-label>span{font-size:11px;color:rgba(var(--v-theme-on-surface),.55);margin-top:3px}.toolbox-external{opacity:.35}
.toolbox-link:hover .toolbox-external,.toolbox-link:focus-visible .toolbox-external{opacity:.8}
</style>
