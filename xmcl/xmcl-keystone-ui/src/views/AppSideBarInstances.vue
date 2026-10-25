<template>
  <div ref="instancesRoot" class="sidebar-instances" :class="{ 'sidebar-instances--labeled': labeled }">
    <SidebarSelection
      v-if="!sharedSelection"
      :container="instancesRoot"
      :selector="selectionSelector"
    />
    <template>
      <v-skeleton-loader
        v-for="i in 5"
        :key="i"
        class="non-moveable my-2 mx-auto sidebar-instances__skeleton"
        :class="{ 'sidebar-instances__skeleton--labeled': labeled }"
        type="avatar"
      />
    </template>
    <template
      v-for="(i, index) of filteredGroups"
      :key="typeof i === 'string' ? i + index : i.id + index"
    >
      <AppSideBarInstanceItem
        v-if="typeof i === 'string'"
        :path="i"
        :pinned="isPinned(i)"
        :labeled="labeled"
        @arrange="move($event.targetPath, i, $event.previous)"
        @group="group($event, i)"
        @toggle-pin="togglePin(i)"
      />
      <AppSideBarGroupItem
        v-else-if="typeof i === 'object'"
        :group="i"
        :color="i.color || defaultColor"
        :labeled="labeled"
        :data-active-group="i.instances.includes(selectedInstance)"
        @arrange="move($event.targetPath, $event.toPath || i, $event.previous)"
        @group="group($event, i)"
        @setting="edit($event.id, { name: $event.name, color: $event.color })"
      />
    </template>

    <AppSideBarItem
      id="create-instance-button"
      data-testid="create-instance"
      v-shared-tooltip.right="labeled ? undefined : () => t('instances.add')"
      :aria-label="t('instances.add')"
      icon="add"
      clickable
      :label="labeled ? t('instances.add') : undefined"
      class="add-instance-button"
      @click="showAddInstance()"
    />
  </div>
</template>
<script setup lang="ts">
import { useDialog } from '@/composables/dialog'
import { useInstanceGroup, useInstanceGroupDefaultColor } from '@/composables/instanceGroup'
import { AddInstanceDialogKey } from '@/composables/instanceTemplates'
import { kInstances } from '@/composables/instances'
import { useInjectSidebarSettings } from '@/composables/sidebarSettings'
import { vSharedTooltip } from '@/directives/sharedTooltip'
import { injection } from '@/util/inject'
import AppSideBarGroupItem from './AppSideBarGroupItem.vue'
import AppSideBarInstanceItem from './AppSideBarInstanceItem.vue'
import AppSideBarItem from './AppSideBarItem.vue'
import SidebarSelection from '@/components/SidebarSelection.vue'

const props = withDefaults(defineProps<{ labeled?: boolean; sharedSelection?: boolean }>(), { labeled: false, sharedSelection: false })

const { t } = useI18n()

const { isValidating, selectedInstance } = injection(kInstances)

const { show: showAddInstance } = useDialog(AddInstanceDialogKey)

const { groups, move, group, edit } = useInstanceGroup()
const { showOnlyPinned, pinnedInstances } = useInjectSidebarSettings()

// Check if instance is pinned
const isPinned = (path: string) => pinnedInstances.value.includes(path)

// Toggle pin state for an instance
const togglePin = (path: string) => {
  const idx = pinnedInstances.value.indexOf(path)
  if (idx >= 0) {
    pinnedInstances.value.splice(idx, 1)
  } else {
    pinnedInstances.value.push(path)
  }
}

// Filter groups based on showOnlyPinned setting
const filteredGroups = computed(() => {
  let items = groups.value

  // Apply pinned filter
  if (showOnlyPinned.value) {
    items = items.filter(item => {
      if (typeof item === 'string') {
        return isPinned(item) || selectedInstance.value === item
      } else {
        // For groups, check if any instance in the group is pinned
        return item.instances.some(inst => isPinned(inst) || selectedInstance.value === inst)
      }
    })
  }

  return items
})

const defaultColor = useInstanceGroupDefaultColor()

const route = useRoute()
const instancesRoot = ref<HTMLElement>()
const selectionSelector = computed(() => props.labeled && route.matched[0]?.path === '/'
  ? '.sidebar-instance--active, [data-active-group="true"]:not(:has(.sidebar-instance--active)) > .sidebar-group'
  : undefined)
</script>

<style scoped>
.sidebar-instances {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.sidebar-instances--labeled :deep(.sidebar-instance__indicator),
.sidebar-instances--labeled :deep(.sidebar-group__indicator) {
  display: none;
}

.sidebar-instances__skeleton {
  width: 48px;
  height: 48px;
}

.sidebar-instances__skeleton--labeled {
  width: 100%;
  height: 46px;
  border-radius: 10px;
}

.add-instance-button {
  --sidebar-item-color: #4caf50;
}
</style>

<style>

.sidebar-instances__skeleton .v-skeleton-loader__avatar {
  margin: 0 auto !important;
}
</style>
