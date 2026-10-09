<script setup lang="ts">
import { ShieldAlert } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
</script>

<template>
  <section
    class="kms-page"
    role="alert"
  >
    <PageHeader
      title="无权访问"
      description="当前身份没有访问此页面的权限。"
    />
    <div class="kms-empty-state">
      <ShieldAlert
        class="kms-empty-state-icon"
        aria-hidden="true"
      />
      <h2>权限不足</h2>
      <p>页面权限随角色分配生效，如需访问请联系管理员分配对应权限后重新登录。</p>
    </div>
  </section>
</template>
