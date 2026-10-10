<script setup lang="ts">
import { LogIn } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
</script>

<template>
  <section class="kms-page">
    <PageHeader
      title="KMS 管理"
      description="密钥管理控制台"
    />
    <div class="admin-empty-state">
      <LogIn
        class="admin-empty-state-icon"
        aria-hidden="true"
      />
      <h2>请从门户进入</h2>
      <p>请从统一应用门户进入密钥管理。</p>
    </div>
  </section>
</template>
