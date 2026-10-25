<template>
  <div ref="root" class="community-markdown">
    <div @click="handleClick" v-html="rendered" />
    <Teleport v-for="(block, index) in blocks" :key="index" :to="block.target">
      <v-btn size="x-small" variant="text" aria-label="复制代码" :ripple="true" @click="copyCode(block.code)">复制</v-btn>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import { renderCommunityMarkdown } from '@/util/communityMarkdown'
const props = defineProps<{ text: string }>()
const emit = defineEmits<{ link: [url: string]; notice: [message: string] }>()
const rendered = computed(() => renderCommunityMarkdown(props.text))
const root = ref<HTMLElement>()
const blocks = shallowRef<Array<{ target: HTMLElement; code: string }>>([])
watch(rendered, async () => {
  blocks.value = []
  await nextTick()
  blocks.value = [...(root.value?.querySelectorAll<HTMLElement>('.community-code-actions') || [])].map(target => ({ target, code: target.parentElement?.querySelector('code')?.textContent || '' }))
}, { immediate: true, flush: 'post' })
function handleClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (link) { event.preventDefault(); emit('link', link.href) }
}
async function copyCode(code: string) {
  try { await navigator.clipboard.writeText(code); emit('notice', '代码已复制') } catch { emit('notice', '复制失败，请选中代码手动复制。') }
}
</script>
<style scoped>
.community-markdown{font-size:14px;line-height:1.95;overflow-wrap:anywhere}.community-markdown :deep(p){margin:14px 0}.community-markdown :deep(h1),.community-markdown :deep(h2),.community-markdown :deep(h3){font-size:17px;font-weight:650;margin:24px 0 8px}.community-markdown :deep(ul),.community-markdown :deep(ol){padding-left:23px}.community-markdown :deep(a){color:rgb(var(--v-theme-primary));text-decoration:underline;text-underline-offset:3px}.community-markdown :deep(pre){padding:18px 15px;margin:16px 0;background:rgba(var(--v-theme-on-surface),.035);border:1px solid rgba(var(--v-theme-on-surface),.08);border-radius:8px;overflow:auto;white-space:pre-wrap}.community-markdown :deep(code){font:12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace}.community-markdown :deep(blockquote){border-left:3px solid rgba(var(--v-theme-primary),.35);padding-left:16px;opacity:.75}.community-markdown :deep(.community-code){position:relative}.community-markdown :deep(.community-code pre){padding-top:34px}.community-markdown :deep(.community-copy-code){border:0;background:transparent;cursor:pointer;font-family:inherit;position:absolute;right:10px;top:7px;font-size:11px;color:rgba(var(--v-theme-on-surface),.65);padding:2px 6px;border-radius:4px}.community-markdown :deep(table){border-collapse:collapse;display:block;overflow:auto;max-width:100%}.community-markdown :deep(td),.community-markdown :deep(th){border:1px solid rgba(var(--v-theme-on-surface),.1);padding:5px 10px}
.community-markdown :deep(.community-code-actions){position:absolute;right:8px;top:4px}.community-markdown :deep(.v-btn){text-transform:none;letter-spacing:normal;font-family:inherit}
</style>
