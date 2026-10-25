<template>
  <div
    data-testid="settings-page"
    class="d-flex fill-height min-h-0 min-w-0 setting-page"
  >
    <!-- Navigation Sidebar (Only in Wide/Scroll Mode) -->
    <nav v-if="!isNarrowView" ref="settingsNav" id="settings-nav" class="setting-sidebar" :aria-label="t('setting.name', 2)">
      <SidebarSelection :container="settingsNav" selector=".v-list-item--active" />
      <div class="setting-sidebar__label">
        {{ t('setting.name') }}
      </div>
      <v-list
        nav
        density="compact"
        color="primary"
        class="setting-sidebar__list"
        :selected="[activeSectionIndex]"
        @update:selected="v => activeSectionIndex = (v[0] as number) ?? 0"
      >
        <v-list-item
          v-for="(item, idx) in sections"
          :key="item.id"
          :value="idx"
          class="mb-1 rounded-lg"
          color="primary"
          :title="t(item.title)"
          @click="scrollTo(item.id)"
        >
          <template #prepend>
            <v-icon size="small">{{ item.icon }}</v-icon>
          </template>
        </v-list-item>
      </v-list>
    </nav>

    <!-- Content Area -->
    <div 
      class="flex-grow-1 min-w-0 overflow-y-auto fill-height scroll-container visible-scroll" 
      :class="{ 'has-sticky-tabs': isNarrowView }"
      ref="scrollContainer"
      @scroll="onScroll"
    >
      <!-- Sticky Tabs Header (Only in Narrow/Tabs Mode) -->
      <div v-if="isNarrowView" class="sticky-tabs-wrapper">
        <v-tabs
          v-model="activeSectionIndex"
          align-tabs="center"
          bg-color="transparent"
          color="primary"
          show-arrows
          :aria-label="t('setting.name', 2)"
          class="rounded-lg"
          @update:model-value="onTabChange"
        >
          <v-tab v-for="item in sections" :key="item.id">
            <v-icon start size="small">{{ item.icon }}</v-icon>
            {{ t(item.title) }}
          </v-tab>
        </v-tabs>
      </div>

      <div class="content-wrapper mx-auto pa-4 pa-md-6" :class="{ 'tabs-mode': isNarrowView }">
        <!-- All sections rendered vertically in both modes -->
        <section id="general" class="mb-8 scroll-target" role="region" :aria-label="t('setting.general')">
          <SettingHeader
            :title="t('setting.general')"
            icon="settings"
          />
          <SettingGeneral class="mb-4" />
          <SettingAdvanced />
        </section>
        <section id="appearance" class="mb-8 scroll-target" role="region" :aria-label="t('setting.appearance')">
          <SettingHeader
            icon="brush"
            :title="t('setting.appearance')"
            :subtitle="t('setting.appearanceDescription')"
          />
          <SettingGlobalUI />
        </section>
        <section id="global" class="mb-8 scroll-target" role="region" :aria-label="t('setting.globalSetting')">
          <SettingHeader
            :title="'🌍 ' + t('setting.globalSetting')"
            :subtitle="t('setting.globalSettingHint')"
          />
          <SettingGlobal />
        </section>
        <section id="network" class="mb-8 scroll-target" role="region" :aria-label="t('setting.network')">
          <SettingHeader
            :title="t('setting.network')"
            icon="public"
          />
          <SettingNetwork />
        </section>
        <section id="about" class="mb-12 scroll-target" role="region" :aria-label="t('setting.about')">
          <SettingHeader
            :title="t('setting.about')"
            icon="info"
          />
          <SettingUpdate class="mb-4" />
          <SettingAbout />
        </section>
      </div>

      <SettingUpdateInfoDialog />
      <SettingMigrationDialog />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import SidebarSelection from '@/components/SidebarSelection.vue'
const settingsNav = ref<HTMLElement>()
import { useI18n } from 'vue-i18n'
import SettingUpdateInfoDialog from './SettingUpdateInfoDialog.vue'
import SettingUpdate from './SettingUpdate.vue'
import SettingGeneral from './SettingGeneral.vue'
import SettingMigrationDialog from './SettingMigrationDialog.vue'
import SettingGlobal from './SettingGlobal.vue'
import SettingAbout from './SettingAbout.vue'
import SettingNetwork from './SettingNetwork.vue'
import { usePresence } from '@/composables/presence'
import { useTutorial } from '@/composables/tutorial'
import { kUpdateSettings, useUpdateSettings } from '@/composables/setting'
import { injection } from '@/util/inject'
import { kTheme } from '@/composables/theme'
import SettingGlobalUI from './SettingGlobalUI.vue'
import { useMediaQuery } from '@vueuse/core'
import SettingAdvanced from './SettingAdvanced.vue'
import SettingHeader from '@/components/SettingHeader.vue'

const { t } = useI18n()
usePresence(computed(() => t('presence.setting')))

provide(kUpdateSettings, useUpdateSettings())

const { suppressed } = injection(kTheme)

onMounted(() => {
  suppressed.value = true
})
onUnmounted(() => {
  suppressed.value = false
})

const NARROW_BREAKPOINT = 960 // Switch to tabs view when window is narrower than this
const isNarrowView = useMediaQuery(`(max-width: ${NARROW_BREAKPOINT - 1}px)`)

// Navigation Logic
const activeSectionIndex = ref(0)
const scrollContainer = ref<HTMLElement | null>(null)
const isUserScrolling = ref(false)
let scrollTimeout: ReturnType<typeof setTimeout> | null = null

const sections = [
  { id: 'general', title: 'setting.general', icon: 'tune' },
  { id: 'appearance', title: 'setting.appearance', icon: 'palette' },
  { id: 'global', title: 'setting.globalSetting', icon: 'videogame_asset' },
  { id: 'network', title: 'setting.network', icon: 'wifi' },
  { id: 'about', title: 'setting.about', icon: 'info' },
]

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (el && scrollContainer.value) {
    isUserScrolling.value = true
    // Account for sticky tabs height in narrow view
    const stickyOffset = isNarrowView.value ? 60 : 20
    const offsetTop = el.offsetTop - stickyOffset
    scrollContainer.value.scrollTo({ top: offsetTop, behavior: 'smooth' })
    
    // Reset user scrolling flag after animation completes
    if (scrollTimeout) clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(() => {
      isUserScrolling.value = false
    }, 500)
  }
}

function onTabChange(index: number) {
  const section = sections[index]
  if (section) {
    scrollTo(section.id)
  }
}

function onScroll() {
  if (!scrollContainer.value || isUserScrolling.value) return
  
  const container = scrollContainer.value
  // Account for sticky tabs height in narrow view
  const stickyOffset = isNarrowView.value ? 80 : 100
  const scrollTop = container.scrollTop + stickyOffset
  
  for (let i = sections.length - 1; i >= 0; i--) {
    const el = document.getElementById(sections[i].id)
    if (el && el.offsetTop <= scrollTop) {
      activeSectionIndex.value = i
      break
    }
  }
}

useTutorial(
  computed(() => [
    {
      element: '#settings-nav',
      popover: {
        title: t('setting.name', 2),
        description: t('tutorial.settings.navDescription'),
      },
    },
    {
      element: '#general',
      popover: {
        title: t('setting.general'),
        description: t('tutorial.settings.generalDescription'),
      },
    },
    {
      element: '#appearance',
      popover: {
        title: t('setting.appearance'),
        description: t('tutorial.settings.appearanceDescription'),
      },
    },
    {
      element: '#global',
      popover: {
        title: t('setting.globalSetting'),
        description: t('tutorial.settings.globalDescription'),
      },
    },
    {
      element: '#network',
      popover: {
        title: t('setting.network'),
        description: t('tutorial.settings.networkDescription'),
      },
    },
  ]),
)
</script>

<style scoped>
.setting-page {
  background: transparent;
  user-select: none;
}

.setting-sidebar {
  width: 208px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: fit-content;
  max-height: 100vh;
  padding: 14px 8px 12px 12px;
}

/* Flat workspace sub-navigation: no floating card, aligned with the
   primary sidebar's section rhythm. */
.setting-sidebar__label {
  padding: 2px 12px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  opacity: 0.55;
}

.setting-sidebar__list {
  background: transparent !important;
  padding: 0;
}

.scroll-container {
  scroll-behavior: smooth;
  position: relative;
}

.scroll-container.has-sticky-tabs {
  padding-top: 0;
}

.sticky-tabs-wrapper {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(var(--v-theme-surface), 0.95);
  backdrop-filter: blur(8px);
  padding: 8px 0;
  margin-bottom: 16px;
}

.content-wrapper {
  max-width: 80rem;
}

.scroll-target {
  scroll-margin-top: 80px;
}
</style>
