<template>
  <div
    v-if="!isHorizontal"
    ref="sidebarRoot"
    data-testid="app-sidebar"
    role="navigation"
    aria-orientation="vertical"
    :aria-label="navigationAriaLabel"
    class="sidebar ws-sidebar moveable z-10"
    :style="{ 'backdrop-filter': `blur(${blurSidebar}px)`, backgroundColor: sideBarColor }"
  >
    <SidebarSelection :container="sidebarRoot" :selector="selectionSelector" />
    <!-- Brand row -->
    <div class="ws-sidebar__brand">
      <img :src="toraLogo" alt="TMCL" class="ws-sidebar__logo" draggable="false">
      <span class="ws-sidebar__brand-name">TORA</span>
      <button
        v-shared-tooltip.right="() => t('shared.back')"
        type="button"
        class="ws-sidebar__back non-moveable"
        :aria-label="backAriaLabel"
        @click="goBack"
      >
        <v-icon :size="16">
          arrow_back
        </v-icon>
      </button>
    </div>

    <!-- User row -->
    <router-link
      id="my-stuff-button"
      data-testid="nav-accounts"
      v-shared-tooltip.right="isCollapsed ? () => t('myStuff') : undefined"
      to="/me"
      class="ws-sidebar__user non-moveable"
      :aria-label="myStuffAriaLabel"
    >
      <PlayerAvatar
        class="ws-sidebar__avatar overflow-hidden"
        :src="gameProfile?.textures?.SKIN?.url"
        :dimension="34"
      />
      <span class="ws-sidebar__user-text">
        <span class="ws-sidebar__user-name">{{ userName }}</span>
        <span class="ws-sidebar__user-sub">{{ t('myStuff') }}</span>
      </span>
    </router-link>

    <div class="ws-sidebar__divider" />

    <!-- Primary navigation -->
    <nav v-roving-tabindex role="group" class="ws-sidebar__nav">
      <AppSideBarItem
        data-testid="nav-home"
        icon="space_dashboard"
        :icon-size="20"
        :label="t('home')"
        :active="isHomeActive"
        clickable
        to="/"
        @click="homeSelection = true"
      />
      <AppSideBarItem
        data-testid="nav-community"
        v-shared-tooltip.right="isCollapsed ? () => t('tora.communityName') : undefined"
        icon="forum"
        :icon-size="20"
        :label="t('tora.communityName')"
        :aria-label="t('tora.communityName')"
        :active="isCommunityActive"
        clickable
        to="/community"
      />
      <AppSideBarItem data-testid="nav-terracotta" icon="lan" :icon-size="20" :label="t('customDownload.multiplayer')" :aria-label="t('customDownload.multiplayer')" :active="route.path === '/multiplayer'" clickable to="/multiplayer" />
      <AppSideBarItem data-testid="nav-misc" v-shared-tooltip.right="isCollapsed ? () => t('customDownload.misc') : undefined" icon="widgets" :icon-size="20" :label="t('customDownload.misc')" :aria-label="t('customDownload.misc')" :active="route.path === '/misc'" clickable to="/misc" />
      <AppSideBarItem
        data-testid="nav-settings"
        icon="settings"
        :icon-size="20"
        :label="t('setting.name', 2)"
        :active="isSettingsActive"
        clickable
        to="/setting"
        :aria-label="settingsAriaLabel"
      >
        <template #append>
          <span
            v-if="state?.updateStatus !== 'none'"
            class="ws-sidebar__dot ws-sidebar__dot--info"
          />
        </template>
      </AppSideBarItem>
    </nav>

    <div class="ws-sidebar__divider" />

    <!-- Instances -->
    <div class="ws-sidebar__section-header">
      {{ t('sidebar.instances') }}
    </div>
    <div
      ref="instancesScrollEl"
      v-roving-tabindex
      role="group"
      class="sidebar__instances ws-sidebar__instances"
      @click.capture="homeSelection = false"
      @keydown.capture="onInstanceKey"
    >
      <AppSideBarInstances labeled shared-selection />
    </div>

    <div class="ws-sidebar__divider" />
  </div>

  <div
    v-else
    role="navigation"
    aria-orientation="horizontal"
    :aria-label="navigationAriaLabel"
    class="sidebar-horizontal moveable z-10 rounded-[0.75rem] flex flex-row items-center px-2 h-12 mx-2 my-2 elevation-4"
    :style="{ 'backdrop-filter': `blur(${blurSidebar}px)`, backgroundColor: sideBarColor }"
  >
    <div v-roving-tabindex role="group" class="flex flex-row items-center flex-grow-0">
      <v-btn
        v-shared-tooltip.bottom="t('shared.back')"
        icon
        :aria-label="backAriaLabel"
        class="non-moveable mr-1"
        @click="goBack"
      >
        <v-icon>arrow_back</v-icon>
      </v-btn>

      <v-btn
        id="my-stuff-button"
        data-testid="nav-accounts"
        v-shared-tooltip.bottom="t('myStuff')"
        icon
        to="/me"
        :aria-label="myStuffAriaLabel"
        class="non-moveable mr-1"
      >
        <PlayerAvatar
          class="overflow-hidden rounded-full"
          :src="gameProfile?.textures?.SKIN?.url"
          :dimension="28"
        />
      </v-btn>

      <v-btn data-testid="nav-terracotta" icon="lan" variant="text" to="/multiplayer" :aria-label="t('customDownload.multiplayer')" />
      <v-btn data-testid="nav-misc" icon="widgets" variant="text" to="/misc" :aria-label="t('customDownload.misc')" />
      <v-divider vertical class="mx-2 h-6" />
    </div>

    <div class="flex-grow-1 overflow-hidden h-full flex items-center relative" style="min-width: 0;" v-roving-tabindex role="group">
      <AppSideBarInstances />
    </div>

    <div v-roving-tabindex role="group" class="flex flex-row items-center flex-grow-0">
      <v-divider vertical class="mx-2 h-6" />

      <v-btn
        data-testid="nav-community"
        v-shared-tooltip.bottom="t('tora.communityName')"
        icon
        to="/community"
        :aria-label="t('tora.communityName')"
        class="non-moveable mr-1"
      >
        <v-icon :size="23">forum</v-icon>
      </v-btn>

      


      <v-btn
        data-testid="nav-settings"
        v-shared-tooltip.bottom="t('setting.name', 2)"
        icon
        to="/setting"
        :aria-label="settingsAriaLabel"
        class="non-moveable"
      >
        <v-badge
          right
          overlap
          :model-value="state?.updateStatus !== 'none'"
        >
          <template #badge>
            <span aria-hidden="true">{{ 1 }}</span>
          </template>
          <v-icon>settings</v-icon>
        </v-badge>
      </v-btn>
    </div>
  </div>
</template>

<script lang="ts" setup>
import PlayerAvatar from '@/components/PlayerAvatar.vue'
import { useDragAutoScroll } from '@/composables/dragAutoScroll'
import { kSettingsState } from '@/composables/setting'
import { useInjectSidebarSettings } from '@/composables/sidebarSettings'
import { kTheme } from '@/composables/theme'
import { kUserContext } from '@/composables/user'
import { vRovingTabindex } from '@/directives/rovingTabindex'
import { vSharedTooltip } from '@/directives/sharedTooltip'
import { injection } from '@/util/inject'
import toraLogo from '@/assets/tora.png'
import SidebarSelection from '@/components/SidebarSelection.vue'
import { kInstances } from '@/composables/instances'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import AppSideBarInstances from './AppSideBarInstances.vue'
import AppSideBarItem from './AppSideBarItem.vue'

const { blurSidebar, sideBarColor } = injection(kTheme)
const { state } = injection(kSettingsState)
const { gameProfile, userProfile } = injection(kUserContext)
const { position } = useInjectSidebarSettings()

const isHorizontal = computed(() => position.value === 'top' || position.value === 'bottom')
const isCollapsed = useMediaQuery('(max-width: 900px)')

const { t } = useI18n()
const { back } = useRouter()
const route = useRoute()

const userName = computed(() => gameProfile.value?.name || userProfile.value?.username || t('myStuff'))

const isHomeActive = computed(() => route.matched[0]?.path === '/')
const isSettingsActive = computed(() => route.path.startsWith('/setting'))
const isCommunityActive = computed(() => route.path.startsWith('/community'))

// One mounted bar follows account, primary navigation and instance rows.
const sidebarRoot = ref<HTMLElement>()
const homeSelection = ref(true)
const { selectedInstance } = injection(kInstances)
watch(selectedInstance, () => { homeSelection.value = false })
function onInstanceKey(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') homeSelection.value = false
}
const selectionSelector = computed(() => {
  if (route.path === '/misc') return '[data-testid="nav-misc"]'
  if (route.path === '/multiplayer') return '[data-testid="nav-terracotta"]'
  if (isSettingsActive.value) return '[data-testid="nav-settings"]'
  if (isCommunityActive.value) return '[data-testid="nav-community"]'
  if (route.path.startsWith('/me')) return '[data-testid="nav-accounts"]'
  if (isHomeActive.value) return homeSelection.value
    ? '[data-testid="nav-home"]'
    : '.sidebar-instance--active, [data-active-group="true"]:not(:has(.sidebar-instance--active)) > .sidebar-group'
  return undefined
})

const navigationAriaLabel = 'Sidebar navigation'
const backAriaLabel = computed(() => t('shared.back'))
const myStuffAriaLabel = computed(() => t('myStuff'))
const settingsAriaLabel = computed(() => t('setting.name', 2))

function goBack() {
  back()
}


// Global hotkey: Alt+Left arrow goes back, mirroring the back button.
// Ignored when focus is inside a text input / textarea / contenteditable
// so users editing text aren't surprised by an unwanted navigation.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!e.altKey || e.key !== 'ArrowLeft') return
  if (e.ctrlKey || e.metaKey || e.shiftKey) return
  const target = e.target as HTMLElement | null
  if (target) {
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
  }
  e.preventDefault()
  goBack()
})

// gh #1396 — Auto-scroll the instances container while an instance is being
// dragged near its top/bottom edge. (Mouse-wheel scrolling during a native
// HTML5 drag isn't possible — Chromium suppresses wheel events for the
// duration of the drag.)
const instancesScrollEl = ref<HTMLDivElement | null>(null)
useDragAutoScroll(instancesScrollEl)
</script>

<style scoped>
.ws-sidebar {
  position: relative;
  min-width: 236px;
  width: 236px;
  max-height: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  border-radius: 0;
  padding: 10px 10px 12px;
  overflow: hidden;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  animation: tora-rise var(--tora-dur-slow, 240ms) var(--tora-ease-emphasized, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}

/* Collapse to an icon rail on narrow windows so the 800px minimum
   window stays comfortable. */
@media (max-width: 900px) {
  .ws-sidebar {
    min-width: 72px;
    width: 72px;
    padding: 10px 8px 12px;
  }
  .ws-sidebar__brand {
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
  }
  .ws-sidebar__brand-name,
  .ws-sidebar__user-text,
  .ws-sidebar__section-header,
  .ws-sidebar__back {
    display: none;
  }
  .ws-sidebar__user {
    justify-content: center;
    padding: 0;
  }
  .ws-sidebar :deep(.sidebar-item--labeled) {
    justify-content: center;
    padding: 0;
    gap: 0;
  }
  .ws-sidebar :deep(.sidebar-item--labeled .sidebar-item__label),
  .ws-sidebar :deep(.sidebar-instance--labeled .sidebar-instance__text),
  .ws-sidebar :deep(.sidebar-group--labeled .sidebar-group__text) {
    display: none;
  }
  .ws-sidebar :deep(.sidebar-instance--labeled),
  .ws-sidebar :deep(.sidebar-group--labeled) {
    justify-content: center;
    padding: 0;
    gap: 0;
    height: 44px;
  }
}

.ws-sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 10px;
  flex-shrink: 0;
}

.ws-sidebar__logo {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ws-sidebar__brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2.5px;
  flex: 1;
}

.ws-sidebar__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background-color: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  transition:
    background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.ws-sidebar__back:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
  opacity: 1;
}

.ws-sidebar__user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  margin-bottom: 4px;
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.ws-sidebar__user:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.07);
}

.ws-sidebar__user.router-link-active {
  background-color: rgba(var(--v-theme-on-surface), 0.05);
}

.ws-sidebar__avatar {
  border-radius: 9px;
  flex-shrink: 0;
}

.ws-sidebar__user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ws-sidebar__user-name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-sidebar__user-sub {
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.62;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-sidebar__divider {
  margin: 6px 4px;
  height: 1px;
  flex-shrink: 0;
  background-color: rgba(var(--v-theme-on-surface), 0.09);
}

.ws-sidebar__nav {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex-shrink: 0;
  padding: 0;
}

.ws-sidebar :deep(.sidebar-item__indicator),
.ws-sidebar :deep(.sidebar-instance__indicator),
.ws-sidebar :deep(.sidebar-group__indicator) {
  display: none;
}

.ws-sidebar__section-header {
  padding: 2px 12px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  opacity: 0.55;
  flex-shrink: 0;
}

.ws-sidebar__instances {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 2px;
  scrollbar-width: none;
}

.ws-sidebar__instances::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}


.ws-sidebar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}


.ws-sidebar__dot--info {
  background-color: rgb(var(--v-theme-primary));
}
</style>
