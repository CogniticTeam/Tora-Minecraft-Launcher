import BaseSetting from '@/views/BaseSetting.vue'
import BaseSettingActions from '@/views/BaseSettingActions.vue'
import BaseSettingExtension from '@/views/BaseSettingExtension.vue'
import Home from '@/views/Home.vue'
import HomeActions from '@/views/HomeActions.vue'
import HomeExtension from '@/views/HomeExtension.vue'
import HomeLayout from '@/views/HomeLayout.vue'
import Me from '@/views/Me.vue'
import Mod from '@/views/Mod.vue'
import ModActions from '@/views/ModActions.vue'
import ModExtension from '@/views/ModExtension.vue'
import ResourcePack from '@/views/ResourcePack.vue'
import ResourcePackActions from '@/views/ResourcePackActions.vue'
import ResourcePackExtension from '@/views/ResourcePackExtension.vue'
import Save from '@/views/Save.vue'
import SaveActions from '@/views/SaveActions.vue'
import SaveExtension from '@/views/SaveExtension.vue'
import Setting from '@/views/Setting.vue'
import ShaderPack from '@/views/ShaderPack.vue'
import ShaderPackActions from '@/views/ShaderPackActions.vue'
import ShaderPackExtension from '@/views/ShaderPackExtension.vue'
import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: HomeLayout,
      children: [
        {
          path: '',
          components: {
            default: Home,
            extensions: HomeExtension,
            actions: HomeActions,
          },
        },
        {
          path: 'save',
          components: {
            default: Save,
            extensions: SaveExtension,
            actions: SaveActions,
          },
        },
        {
          path: 'mods',
          components: {
            default: Mod,
            extensions: ModExtension,
            actions: ModActions,
          },
        },
        {
          path: 'resourcepacks',
          components: {
            default: ResourcePack,
            extensions: ResourcePackExtension,
            actions: ResourcePackActions,
          },
        },
        {
          path: 'shaderpacks',
          components: {
            default: ShaderPack,
            extensions: ShaderPackExtension,
            actions: ShaderPackActions,
          },
        },
        {
          path: 'blueprints',
          meta: { blueprintState: true },
          components: {
            default: () => import('@/views/Blueprint.vue'),
            extensions: () => import('@/views/BlueprintExtension.vue'),
            actions: () => import('@/views/BlueprintActions.vue'),
          },
        },
        {
          path: 'base-setting',
          components: {
            default: BaseSetting,
            extensions: BaseSettingExtension,
            actions: BaseSettingActions,
          },
        },
        {
          path: 'base-setting/modrinth-project',
          redirect: { path: '/base-setting', query: { target: 'modrinth-project' } },
        },
      ],
    },
    // Retired marketplace URLs must not reopen the removed browsing flow.
    {
      path: '/store/:pathMatch(.*)*',
      redirect: '/me',
    },
    {
      path: '/community',
      component: () => import('@/views/Community.vue'),
    },
    {
      path: '/setting',
      component: Setting,
    },
    {
      path: '/me',
      component: Me,
      meta: { workspaceSidePanel: true },
    },
    {
      path: '/multiplayer',
      component: () => import('@/views/Terracotta.vue'),
    },
    {
      path: '/misc',
      component: () => import('@/views/Misc.vue'),
    },
  ],
})

