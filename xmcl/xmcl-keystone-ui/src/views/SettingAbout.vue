<template>
  <section class="about">
    <XmclAccountPanel class="mb-4" />
    <SettingCard>
      <div class="pa-4 pa-md-6">
        <div class="d-flex align-center flex-wrap gap-4 mb-5">
          <v-img :src="logo" alt="TORA Minecraft Launcher" width="64" height="64" class="flex-grow-0 flex-shrink-0" />
          <div><h2 class="text-h6 font-weight-bold">TORA Minecraft Launcher</h2><div class="text-body-2 text-medium-emphasis mt-1">{{ version }}</div></div>
          <v-spacer />
          <v-btn variant="tonal" color="primary" prepend-icon="favorite_border" href="https://afdian.com/a/zhenxun111" target="browser">爱发电赞助</v-btn>
        </div>
        <div class="d-flex align-center flex-wrap gap-2 mb-3"><v-chip variant="tonal" size="small">AGPL-3.0-only</v-chip><v-btn variant="text" size="small" href="https://www.gnu.org/licenses/agpl-3.0.html" target="browser">查看许可证<v-icon end size="16">open_in_new</v-icon></v-btn><v-btn variant="text" size="small" href="https://github.com/CogniticTeam/Tora-Minecraft-Launcher" target="browser">获取完整源码<v-icon end size="16">open_in_new</v-icon></v-btn></div>
        <p class="text-body-2 text-medium-emphasis mb-2">TORA 自有代码以 AGPL-3.0 发布。基于 XMCL 的代码和第三方依赖保留各自的许可与版权声明。</p>
        <v-btn variant="text" size="small" class="mb-4" href="https://github.com/Voxelum/x-minecraft-launcher" target="browser">上游项目 XMCL · MIT</v-btn>
        <p class="text-caption text-medium-emphasis">NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</p>
        <v-divider class="my-6" />
        <h3 class="text-subtitle-1 font-weight-medium mb-4">贡献者</h3>
        <div class="d-flex align-center gap-3"><v-avatar size="52"><v-img :src="producerAvatar" alt="绪山同学的头像" cover /></v-avatar><span class="text-body-1">绪山同学</span></div>
        <v-divider class="my-6" />
        <h3 class="text-subtitle-1 font-weight-medium mb-4">服务器提供商</h3>
        <div class="provider-grid">
          <v-card v-for="provider in providers" :key="provider.name" variant="tonal" :href="provider.url" target="browser" class="pa-4" :ripple="true"><div class="d-flex align-center gap-3"><v-icon>cloud_queue</v-icon><span class="text-body-1">{{ provider.name }}</span><v-spacer /><v-icon size="16">open_in_new</v-icon></div></v-card>
        </div>
        <v-divider class="my-6" />
        <h3 class="text-subtitle-2 font-weight-medium mb-3">{{ t('setting.about') }}</h3>
        <pre class="debug-info-code pa-4 text-caption"><code>{{ debugInfo }}</code></pre>
      </div>
    </SettingCard>
  </section>
</template>
<script lang="ts" setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import XmclAccountPanel from '@/components/XmclAccountPanel.vue'
import SettingCard from '@/components/SettingCard.vue'
import { kEnvironment } from '@/composables/environment'
import { injection } from '@/util/inject'
import logo from '@/assets/tora.png'
import producerAvatar from '@/assets/producer-avatar.jpg'
const { t } = useI18n()
const env = injection(kEnvironment)
const version = computed(() => env.value?.version ?? '')
const debugInfo = computed(() => JSON.stringify(env.value, null, 2))
const providers = [{ name: 'Cloudflare', url: 'https://www.cloudflare.com/' }, { name: '腾讯云', url: 'https://cloud.tencent.com/' }]
</script>
<style scoped>
.provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.provider-grid :deep(.v-card){text-decoration:none}
.debug-info-code{background:rgba(var(--v-theme-on-surface),.035);border:var(--card-subsection-border);border-radius:var(--card-item-radius);color:rgba(var(--v-theme-on-surface),.75);max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
@media(max-width:960px){.provider-grid{grid-template-columns:1fr}}
</style>
