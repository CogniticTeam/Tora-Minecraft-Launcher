<template>
  <span
    aria-hidden="true"
    class="sidebar-selection"
    :class="{ 'sidebar-selection--ready': motionReady, 'sidebar-selection--horizontal': horizontal }"
    :style="{ transform: `translate3d(${x}px, ${y}px, 0)`, opacity: visible ? 1 : 0 }"
  />
</template>

<script setup lang="ts">
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  container?: HTMLElement | null
  selector?: string
  horizontal?: boolean
}>()
const root = computed(() => props.container)
const x = ref(0), y = ref(0), visible = ref(false), motionReady = ref(false)
let frame = 0
let readyFrame = 0
let positioned = false

function measure() {
  const parent = root.value
  const target = props.selector && parent?.querySelector<HTMLElement>(props.selector)
  if (!parent || !target || !target.getClientRects().length) {
    visible.value = false
    return
  }
  const bounds = target.getBoundingClientRect()
  // Keep the indicator inside a scrollable instance list's visible area.
  const clip = target.closest<HTMLElement>('.ws-sidebar__instances')
  if (clip) {
    const viewport = clip.getBoundingClientRect()
    if (bounds.top + bounds.height / 2 < viewport.top || bounds.top + bounds.height / 2 > viewport.bottom) {
      visible.value = false
      return
    }
  }
  const box = parent.getBoundingClientRect()
  // Notch navigation can be scaled; transforms use unscaled CSS coordinates.
  const sx = box.width / parent.offsetWidth || 1
  const sy = box.height / parent.offsetHeight || 1
  x.value = (bounds.left - box.left) / sx + parent.scrollLeft + (props.horizontal ? bounds.width / sx / 2 - 9 : 2)
  y.value = (bounds.top - box.top) / sy + parent.scrollTop + (props.horizontal ? bounds.height / sy - 3 : bounds.height / sy / 2 - 9)
  visible.value = true
  if (!positioned) {
    positioned = true
    readyFrame = requestAnimationFrame(() => { motionReady.value = true })
  }
}

function schedule() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(measure)
}
watch([root, () => props.selector, () => props.horizontal], schedule, { flush: 'post', immediate: true })
useResizeObserver(root, schedule)
useMutationObserver(root, schedule, {
  subtree: true, childList: true, attributes: true,
  attributeFilter: ['class', 'aria-pressed', 'data-active-group'],
})
useEventListener(root, 'scroll', schedule, { capture: true, passive: true })
onBeforeUnmount(() => { cancelAnimationFrame(frame); cancelAnimationFrame(readyFrame) })
</script>

<style scoped>
.sidebar-selection {
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 18px;
  border-radius: 3px;
  background: var(--color-primary);
  pointer-events: none;
  z-index: 3;
}
.sidebar-selection--horizontal { width: 18px; height: 3px; }
.sidebar-selection--ready {
  transition: transform 280ms cubic-bezier(.2,.8,.2,1), opacity 120ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-selection--ready { transition: none; }
}
</style>
