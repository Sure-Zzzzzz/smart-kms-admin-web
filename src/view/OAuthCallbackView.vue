<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { handleKmsOAuthCallback } from '../auth/pkce';

const router = useRouter();
const errorMessage = ref('');

onMounted(async () => {
  try {
    const outcome = await handleKmsOAuthCallback();
    if (outcome.kind === 'authorized') await router.replace(outcome.target);
    if (outcome.kind === 'missing-params') errorMessage.value = '授权回调参数不完整。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '授权失败。';
  }
});
</script>

<template>
  <section class="kms-guide">
    <h2>正在校验授权</h2><p
      v-if="errorMessage"
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </section>
</template>
