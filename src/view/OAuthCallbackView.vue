<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { isNavigationFailure, useRouter } from 'vue-router';
import { handleKmsOAuthCallback } from '../auth/pkce';

const router = useRouter();
const statusMessage = ref('正在校验授权');
const errorMessage = ref('');
const fallbackTarget = ref('');
let active = true;
let guardTimer: number | undefined;
const authorization = new AbortController();

onBeforeUnmount(() => {
  active = false;
  authorization.abort();
  window.clearTimeout(guardTimer);
});

onMounted(async () => {
  try {
    const outcome = await handleKmsOAuthCallback(authorization.signal);
    if (!active) return;
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
    if (!active) return;
    errorMessage.value = error instanceof Error ? error.message : '授权失败。';
    fallbackTarget.value = '/';
  }
});

// qiankun 内嵌形态下组件内自导航存在被取消的可能：路由跳转失败或超时则整页跳转兜底，
// 保证授权成功后不存在无声终态。
async function settleNavigate(target: string) {
  const fullTarget = `/app/kms${target}`;
  const guard = new Promise<never>((_, reject) => {
    guardTimer = window.setTimeout(() => reject(new Error('nav-timeout')), 3000);
  });
  try {
    const failure = await Promise.race([router.replace(target), guard]);
    if (active && isNavigationFailure(failure)) window.location.assign(fullTarget);
  } catch {
    if (active) window.location.assign(fullTarget);
  } finally {
    window.clearTimeout(guardTimer);
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
      <a :href="`/app/kms${fallbackTarget}`">重试进入</a>
    </p>
  </section>
</template>
