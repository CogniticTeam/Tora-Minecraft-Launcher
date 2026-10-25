<template>
  <div class="community-posts">
    <v-card v-for="post in posts" :key="post.id" class="community-post-row" variant="flat" :ripple="true" :aria-label="post.title" @click="$emit('open', post.id)">
      <span class="community-avatar" aria-hidden="true">{{ post.author.nickname.slice(0, 1) }}</span>
      <div class="community-post-copy">
        <div class="community-post-title">
          <span class="community-tag" :class="post.type">{{ communityKinds[post.type] }}</span>
          <span v-if="post.status !== 'published'" class="community-tag">{{ post.status === 'pending' ? '待审核' : '已隐藏' }}</span>
          <span v-if="post.accepted_comment_id" class="community-tag solved">已解决</span>
          <span v-if="post.locked" class="community-tag">已锁定</span>
          <h3>{{ post.title }}</h3>
        </div>
        <p>{{ post.summary }}</p>
        <div class="community-post-meta"><span>{{ post.author.nickname }}</span><span>·</span><time :datetime="new Date(post.created_at).toISOString()">{{ communityTime(post.created_at) }}</time><span v-if="post.version" class="community-tag">{{ post.version }}</span><span v-if="post.loader !== '不限'" class="community-tag">{{ post.loader }}</span><span class="community-post-counts"><span :aria-label="`${post.likes} 个赞`"><v-icon :size="13" aria-hidden="true">favorite_border</v-icon> {{ post.likes }}</span><span :aria-label="`${post.comments} 条回复`"><v-icon :size="13" aria-hidden="true">chat_bubble_outline</v-icon> {{ post.comments }}</span></span></div>
      </div>
    </v-card>
  </div>
</template>
<script setup lang="ts">
import { communityKinds, communityTime, type CommunityPost } from '@/util/communityForum'
defineProps<{ posts: CommunityPost[] }>()
defineEmits<{ open: [id: string] }>()
</script>
<style scoped>
.community-posts { display: grid; gap: 10px; }
.community-post-row { padding: 20px; display: flex; gap: 16px; border: var(--card-row-border); border-radius: var(--card-radius); background: rgb(var(--v-theme-surface)); transition: border-color 180ms var(--tora-ease), background-color 180ms var(--tora-ease); }
.community-post-row:hover { border-color: rgba(var(--v-theme-primary),.35); }
.community-avatar { width: 40px; height: 40px; flex-shrink: 0; display: grid; place-items: center; border-radius: var(--card-item-radius); color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary),.08); font-size: 16px; font-weight: 500; }
.community-post-copy { flex: 1; min-width: 0; }
.community-post-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.community-post-title h3 { border: 0; padding: 0; background: none; font-family: inherit; margin:0; font-size: 16px; line-height: 1.6; font-weight: 500; text-align: left; color: rgb(var(--v-theme-on-surface)); overflow-wrap: anywhere; }
.community-post-title h3:hover { color: rgb(var(--v-theme-primary)); }

.community-post-copy>p { font-size: 14px; line-height: 1.7; opacity: .65; margin: 8px 0 12px!important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.community-post-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: rgba(var(--v-theme-on-surface),.6); }
.community-post-counts { margin-left: auto; display: flex; gap: 16px; white-space: nowrap; }
.community-tag { font-size: 12px; padding: 2px 7px; border-radius: calc(var(--card-item-radius) / 2); line-height: 1.5; background: rgba(var(--v-theme-on-surface),.05); color: rgba(var(--v-theme-on-surface),.68); }
.community-tag.talk { color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary),.08); }
.community-tag.help { color: rgb(var(--v-theme-warning)); background: rgba(var(--v-theme-warning),.1); }
.community-tag.tutorial { color: rgb(var(--v-theme-info)); background: rgba(var(--v-theme-info),.1); }
.community-tag.pack,.community-tag.solved { color: rgb(var(--v-theme-success)); background: rgba(var(--v-theme-success),.1); }
@media (max-height:520px) { .community-post-row { padding: 16px; } }
@media (prefers-reduced-motion:reduce) { .community-post-row { transition: none; } }
</style>
