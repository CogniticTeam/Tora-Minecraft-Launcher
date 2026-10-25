<template>
  <div
    v-if="!shouldHideLaunchButton"
    v-roving-tabindex
    role="group"
    aria-orientation="horizontal"
    :aria-label="text"
    class="launch-control flex flex-grow-0 items-center"
    :class="{ 'launch-control--compact': compact || !top }"
  >
    <v-btn
      id="launch-button"
      data-testid="launch-button"
      :disabled="isValidating"
      :color="color"
      variant="flat"
      class="btn-launch"
      :aria-label="text"
      @click="onClick()"
      @mouseenter="onHoverEnter"
      @mouseleave="onHoverLeave"
    >
      <span data-testid="launch-button-play" class="launch-control__icon" aria-hidden="true">
        <v-progress-circular v-if="loading" indeterminate :size="20" :width="2" />
        <v-icon v-else :size="24">{{ leftIcon || icon || 'play_arrow' }}</v-icon>
      </span>
      <span v-if="isGamepadActive" class="gp-btn__key gp-btn__key--primary mr-2">{{ buttonX }}</span>
      <span class="launch-control__label">{{ text }}</span>
      <v-badge :model-value="count !== 0" inline class="pl-1" color="primary" :content="count" />
    </v-btn>

    <v-menu
      v-model="isShown"
      :location="top ? 'top end' : 'bottom end'"
      :open-on-focus="false"
      :open-on-hover="true"
      :open-on-click="false"
      transition="scroll-y-transition"
    >
      <template #activator="{ props: activatorProps }">
        <v-btn
          :disabled="isValidating"
          data-testid="launch-button-menu"
          icon
          variant="flat"
          class="btn-launch-settings"
          :aria-label="t('baseSetting.title', 2)"
          :aria-haspopup="'menu'"
          :aria-expanded="isShown"
          to="/base-setting"
          v-bind="activatorProps"
          @mouseenter="onHoverEnter"
          @mouseleave="onHoverLeave"
        >
          <v-icon :size="21" aria-hidden="true">tune</v-icon>
        </v-btn>
      </template>
      <HomeLaunchButtonMenuList />
    </v-menu>
  </div>
</template>
<script lang="ts" setup>
import { kLaunchButton } from '@/composables/launchButton'
import { injection } from '@/util/inject'
import HomeLaunchButtonMenuList from './HomeLaunchButtonMenuList.vue'
import { kInstances } from '@/composables/instances'
import { vRovingTabindex } from '@/directives/rovingTabindex'
import { kInstance } from '@/composables/instance'
import { useHasMinecraftLicense } from '@/composables/minecraftLicense'
import { useGamepad } from '@/composables/gamepad'
import { isBedrockInstance } from '@xmcl/instance'

defineProps<{ compact?: boolean; top?: boolean }>()

const emit = defineEmits(['mouseenter', 'mouseleave'])
const { isValidating } = injection(kInstances)

const { onClick, color, icon, text, loading, leftIcon, count } = injection(kLaunchButton)
const { isActive: isGamepadActive, buttonX } = useGamepad()
const { t } = useI18n()

const { instance } = injection(kInstance)
const { hasMinecraftLicense } = useHasMinecraftLicense()
const isBedrock = computed(() => isBedrockInstance(instance.value))
const shouldHideLaunchButton = computed(() => isBedrock.value && !hasMinecraftLicense.value)

const isShown = ref(false)

function onHoverEnter() {
  emit('mouseenter')
}
function onHoverLeave() {
  emit('mouseleave')
}
</script>

<style scoped>
.launch-control {
  gap: 8px;
}

.btn-launch {
  height: 54px;
  min-width: 190px;
  padding: 0 25px;
  border-radius: 12px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14);
  transition: filter 160ms ease, box-shadow 160ms ease;
}

.btn-launch:hover {
  filter: brightness(1.04);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

.btn-launch:active {
  filter: brightness(0.97);
}

.launch-control__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-inline-end: 12px;
}

.btn-launch-settings {
  width: 54px;
  height: 54px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.96);
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.launch-control--compact .btn-launch {
  height: 44px;
  min-width: 140px;
  padding: 0 18px;
  font-size: 15px;
}

.launch-control--compact .btn-launch-settings {
  width: 44px;
  height: 44px;
  border-radius: 10px;
}

@media (max-width: 900px) {
  .btn-launch {
    min-width: 150px;
    padding: 0 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn-launch {
    transition: none;
  }
}
</style>
