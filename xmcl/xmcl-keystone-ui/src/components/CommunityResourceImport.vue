<template>
  <v-dialog :model-value="modelValue" max-width="680" :persistent="busy" @update:model-value="v => emit('update:modelValue', v)">
    <v-card class="pa-6"><div class="d-flex align-center mb-4"><h2 class="text-h6">导入社区资源</h2><v-spacer /><v-btn icon="close" variant="text" size="small" aria-label="关闭资源导入" :disabled="busy" @click="emit('update:modelValue',false)" /></div>
      <v-progress-linear v-if="busy" indeterminate color="primary" class="mb-4" />
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
      <template v-if="resource"><h3 class="text-subtitle-1">{{ resource.title }}</h3><p class="text-body-2 text-medium-emphasis mt-2">{{ author || resource.author }} · {{ resource.version }}</p><p class="text-caption text-medium-emphasis mt-2">来源：Modrinth · {{ (resource.size/1024**2).toFixed(1) }} MB · 下载后进行 SHA-512 校验</p>
        <p class="text-body-2 mt-4">Minecraft：{{ resource.gameVersions.join('、') }}<br>加载器：{{ resource.loaders.join('、') || '无特殊要求' }}</p>
        <v-select v-if="resource.type !== 'modpack'" v-model="target" :items="instanceItems" label="导入到实例" variant="outlined" density="comfortable" class="mt-4" hide-details :disabled="busy || !!localPath" />
        <p v-else class="text-body-2 mt-4">此整合包将创建新实例，不覆盖现有实例。</p>
        <v-alert v-if="!compatible" type="warning" variant="tonal" class="mt-4"><p>这个版本与所选实例的游戏版本或加载器不匹配。</p><v-btn variant="text" size="small" :disabled="busy" @click="lookupCompatible">查找兼容版本</v-btn></v-alert>
        <template v-if="localPath"><v-divider class="my-4" /><h4 class="text-subtitle-2 mb-2">将安装的内容 · {{ files.length }} 项</h4><div class="import-files"><div v-for="file in files.slice(0,200)" :key="file">{{ file }}</div><p v-if="files.length>200">另有 {{ files.length-200 }} 项，完整清单将在实例中保留。</p></div><p class="text-caption text-medium-emphasis mt-3">文件已通过完整性校验。资源会影响游戏运行，请确认来源后安装。</p></template>
      </template>
      <v-card-actions class="px-0 pt-5"><v-btn variant="text" :disabled="busy" @click="emit('update:modelValue',false)">取消</v-btn><v-spacer /><v-btn v-if="resource && !localPath" color="primary" variant="tonal" :disabled="!compatible || resource.type !== 'modpack' && !target" :loading="busy" @click="download">下载并查看内容</v-btn><v-btn v-if="localPath" color="primary" variant="flat" :disabled="!compatible" :loading="busy" @click="install">{{ resource?.type === 'modpack' ? '创建新实例并导入' : '确认导入' }}</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { kInstances } from '@/composables/instances'
import { injection } from '@/util/inject'
import { useService } from '@/composables/service'
import { useModpackFinishInstall } from '@/composables/modpackInstaller'
import { useNotifier } from '@/composables/notifier'
import { InstanceModsServiceKey, InstanceResourcePacksServiceKey, InstanceShaderPacksServiceKey, ModpackServiceKey, waitModpackFiles } from '@xmcl/runtime-api'
import type { CommunityResource } from '../../../xmcl-electron-app/instanceCare'
const props=defineProps<{modelValue:boolean;source:string;author?:string}>(),emit=defineEmits<{(e:'update:modelValue',value:boolean):void}>()
const {instances,selectedInstance}=injection(kInstances),{notify}=useNotifier()
const mods=useService(InstanceModsServiceKey),packs=useService(InstanceResourcePacksServiceKey),shaders=useService(InstanceShaderPacksServiceKey),modpacks=useService(ModpackServiceKey),finish=useModpackFinishInstall()
const resource=ref<CommunityResource>(),target=ref(''),localPath=ref(''),files=ref<string[]>([]),busy=ref(false),error=ref('')
const instanceItems=computed(()=>instances.value.filter(i=>i.edition!=='bedrock').map(i=>({title:i.name,value:i.path})))
const instance=computed(()=>instances.value.find(i=>i.path===target.value))
function loader(){const r=instance.value?.runtime;return r?.forge?'forge':r?.neoForged?'neoforge':r?.fabricLoader?'fabric':r?.quiltLoader?'quilt':''}
const compatible=computed(()=>!resource.value||resource.value.type==='modpack'||!instance.value||resource.value.gameVersions.includes(instance.value.runtime.minecraft)&&(resource.value.type!=='mod'||!!loader()&&resource.value.loaders.includes(loader())))
async function run(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{if(typeof instanceCare==='undefined')throw new Error('请在桌面启动器中导入资源。');await fn()}catch(e){error.value=e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'无法完成导入。'}finally{busy.value=false}}
watch(()=>props.modelValue,shown=>{if(!shown)return;target.value=selectedInstance.value;resource.value=undefined;localPath.value='';files.value=[];void run(async()=>{resource.value=await instanceCare.resource(props.source);if(!['modpack','mod','resourcepack','shader'].includes(resource.value.type))throw new Error('这个资源类型暂不支持导入到 Java 实例。')})})
async function lookupCompatible(){await run(async()=>{resource.value=await instanceCare.resource(props.source,instance.value?.runtime.minecraft,loader())})}
async function download(){const r=resource.value;if(!r)return;await run(async()=>{const path=await instanceCare.downloadResource(r.project,r.versionId);if(r.type==='modpack'){const state=await modpacks.openModpack(path);files.value=(await waitModpackFiles(state)).map(f=>f.path)}else files.value=[r.filename];localPath.value=path})}
async function install(){const r=resource.value;if(!r||!localPath.value||!compatible.value)return;await run(async()=>{if(r.type==='modpack')await finish(localPath.value,undefined,{type:'modrinth-modpack',projectId:r.project,versionId:r.versionId});else{if(!instance.value)throw new Error('请先选择实例。');const service=r.type==='mod'?mods:r.type==='shader'?shaders:packs;await service.install({path:target.value,files:[localPath.value]});notify({title:'资源已导入所选实例',level:'success'})}emit('update:modelValue',false)})}
</script>
<style scoped>
.import-files{max-height:220px;overflow:auto;border:1px solid rgba(var(--v-theme-on-surface),.1);border-radius:var(--card-item-radius);padding:12px;font-size:12px;line-height:1.9;overflow-wrap:anywhere}
</style>
