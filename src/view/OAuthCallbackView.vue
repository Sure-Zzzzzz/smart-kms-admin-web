<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { handleKmsOAuthCallback } from '../auth/pkce';

const router = useRouter();
const route = useRoute();
const statusMessage = ref('正在校验授权');
const errorMessage = ref('');
const fallbackTarget = ref('');

onMounted(async () => {
  try {
    const outcome = await handleKmsOAuthCallback();
    if (outcome.kind === 'authorized') {
      statusMessage.value = '授权成功，正在进入…';
      await settleNavigate(outcome.target);
      return;
    }
    if (outcome.kind === 'retrying') {
      statusMessage.value = '授权校验未通过，正在重新发起授权…';
      return;
    }
    errorMessage.value = '授权回调参数不完整，请从统一应用门户重新进入。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '授权失败。';
    fallbackTarget.value = route.fullPath;
  }
});

// qiankun 内嵌形态下组件内自导航存在被取消的可能：路由跳转失败或超时则整页跳转兜底，
// 保证授权成功后不存在无声终态。
async function settleNavigate(target: string) {
  const fullTarget = `/app/kms${target}`;
  const guard = new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('nav-timeout')), 3000); });
  try {
    await Promise.race([router.replace(target), guard]);
  } catch {
    window.location.assign(fullTarget);
  }
}
</script>

<template>
  <section class="kms-guide">
    <h2 v-if="!errorMessage">
      {{ statusMessage }}
    </h2>
    <p
      v-if="errorMessage"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <p v-if="errorMessage && fallbackTarget">
      <a :href="`/app/kms${fallbackTarget === '/oauth-callback' ? '/my-keys' : fallbackTarget}`">重试进入</a>
    </p>
  </section>
</template>
