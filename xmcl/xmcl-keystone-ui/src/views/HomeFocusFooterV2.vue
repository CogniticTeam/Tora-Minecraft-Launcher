<template>
  <div class="w-full">
    <div class="relative footer flex-grow flex items-end">
      <HomeFooterCard />
      <div
        key="launch-button-group"
        class="flex flex-wrap justify-end items-center gap-y-6 gap-x-2 flex-grow"
      >
        <HomeLaunchButtonStatus
          class="mr-4 ml-2"
          :active="active"
        />
        <HomeLaunchButton
          top
          @mouseenter="active = true"
          @mouseleave="active = false"
        />
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
import HomeLaunchButton from './HomeLaunchButton.vue'
import HomeLaunchButtonStatus from './HomeLaunchButtonStatus.vue'
import HomeFooterCard from './HomeFooterCard.vue'

const active = ref(false)
</script>

<style>
.tabs>div[role="tablist"] {
  background: var(--color-sidebar-bg) !important;
  backdrop-filter: blur(var(--blur-card));
}
</style>
<style scoped>
.footer {
  @apply mx-6;
  gap: 16px;
}

.footer :deep(.tabs-card) {
  flex: 0 1 450px;
  min-width: 260px;
}

@media (max-width: 850px) {
  .footer {
    @apply mr-2;
  }
}
</style>