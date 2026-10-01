<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { listKmsDestructionJobs, loadKmsWorkerHealth, type KmsDestructionJob, type KmsWorkerHealth } from '../api/kmsApi';

const jobs = ref<KmsDestructionJob[]>([]); const health = ref<KmsWorkerHealth | null>(null); const loading = ref(false); const errorMessage = ref('');
function time(value: string | null) { return value ? new Date(value).toLocaleString() : '-'; }
async function load() { errorMessage.value = ''; loading.value = true; try { const [page, worker] = await Promise.all([listKmsDestructionJobs(), loadKmsWorkerHealth()]); jobs.value = page.items; health.value = worker; } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; } finally { loading.value = false; } }
onMounted(() => { void load(); });
</script>

<template>
  <section class="kms-page">
    <header class="kms-page-header">
      <div><span>生命周期</span><h1>销毁任务</h1></div>
    </header><p
      v-if="errorMessage"
      class="kms-message danger"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <section class="kms-health-band">
      <div><strong>{{ health?.running ? (health.claimable ? 'Worker 正常运行' : 'Worker 已暂停领取') : 'Worker 未运行' }}</strong><span>最近成功扫描：{{ time(health?.lastSuccessfulScanAt || null) }} · 连续失败：{{ health?.consecutiveFailureCount ?? 0 }}</span></div>
    </section>
    <section class="admin-data-surface">
      <div class="kms-surface-header">
        <h2>待处理与历史任务</h2>
      </div><div class="kms-table-wrap">
        <table class="responsive-table">
          <thead><tr><th>密钥</th><th>版本</th><th>状态</th><th>计划时间</th><th>租约到期</th><th>尝试次数</th></tr></thead><tbody>
            <tr
              v-for="job in jobs"
              :key="`${job.keyRef}-${job.keyVersion}`"
            >
              <td><code>{{ job.keyRef }}</code></td><td>{{ job.keyVersion }}</td><td>
                <span
                  class="status-badge"
                  :class="job.state === 'COMPLETED' ? 'success' : job.state === 'CLAIMED' ? 'warning' : 'neutral'"
                >{{ job.state }}</span>
              </td><td>{{ time(job.dueAt) }}</td><td>{{ time(job.claimUntil) }}</td><td>{{ job.attemptCount }}</td>
            </tr><tr v-if="!loading && jobs.length === 0">
              <td
                colspan="6"
                class="kms-empty"
              >
                当前没有销毁任务
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>
