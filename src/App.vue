<script setup lang="ts">
import { computed } from 'vue';
import { RouterView } from 'vue-router';
import { hasKmsPagePermission, kmsState } from './kmsState';

const standalone = computed(() => !kmsState.bridge);
const menus = [
  { to: '/my-keys', label: '我的密钥', permission: 'kms.page.my-keys' },
  { to: '/keys', label: '密钥', permission: 'kms.page.keys' },
  { to: '/policies', label: '策略', permission: 'kms.page.policies' },
  { to: '/destruction', label: '销毁任务', permission: 'kms.page.destruction' }
];
</script>

<template>
  <section class="kms-admin-app">
    <!-- 门户 qiankun 形态：应用菜单已由门户侧栏承载，子应用只渲染内容区；
         standalone（独立调试/直开）形态才渲染自有导航壳 -->
    <header
      v-if="standalone"
      class="kms-standalone-header"
    >
      <div><span>KMS</span><h1>密钥管理</h1></div>
      <nav
        class="kms-module-nav"
        aria-label="KMS 管理导航"
      >
        <RouterLink
          v-for="item in menus.filter(menu => hasKmsPagePermission(menu.permission))"
          :key="item.to"
          :to="item.to"
        >
{{ item.label }}
        </RouterLink>
      </nav>
    </header>
    <RouterView />
  </section>
</template>
