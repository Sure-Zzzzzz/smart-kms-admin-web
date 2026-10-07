<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { principalLabel, principalSourceKind, principalSourceText } from '../support/principal';
import { RefreshCw, Search } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { listKmsDestructionJobs, loadKmsWorkerHealth, type KmsDestructionJob, type KmsWorkerHealth } from '../api/kmsApi';
import { kmsState } from '../kmsState';

const jobs = ref<KmsDestructionJob[]>([]);
const currentPage = ref(1);
const pageSize = ref(20);
const totalElements = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(totalElements.value / pageSize.value)));
const jobsLoaded = ref(false);
const ownerFilter = ref('');
const loading = ref(false);
const jobsErrorMessage = ref('');
const health = ref<KmsWorkerHealth | null>(null);
const workerLoading = ref(false);
const workerErrorMessage = ref('');
let jobsLoadSequence = 0;
let workerLoadSequence = 0;
function searchJobs() { currentPage.value = 1; void loadJobs(); }
function time(value: string | null) { return value ? new Date(value).toLocaleString() : '-'; }
const healthSummary = computed(() => {
  if (workerLoading.value) return '正在读取 Worker 状态';
  if (health.value === null) return '暂未取得 Worker 状态';
  if (!health.value.running) return 'Worker 未运行';
  return health.value.claimable ? 'Worker 正常运行' : 'Worker 已暂停领取';
});

async function loadJobs() {
  const sequence = ++jobsLoadSequence;
  const principalId = kmsState.me?.principalId;
  const requestedPage = currentPage.value;
  const requestedSize = pageSize.value;
  jobsErrorMessage.value = '';
  jobs.value = [];
  jobsLoaded.value = false;
  if (!principalId) { loading.value = false; return; }
  loading.value = true;
  try {
    const result = await listKmsDestructionJobs(requestedPage, requestedSize, ownerFilter.value.trim() || undefined);
    if (sequence !== jobsLoadSequence || principalId !== kmsState.me?.principalId) return;
    totalElements.value = result.total;
    if (requestedPage > totalPages.value) {
      currentPage.value = totalPages.value;
      await loadJobs();
      return;
    }
    jobs.value = result.items;
    jobsLoaded.value = true;
  } catch (error) {
    if (sequence === jobsLoadSequence && principalId === kmsState.me?.principalId) jobsErrorMessage.value = error instanceof Error ? error.message : '查询销毁任务失败';
  } finally {
    if (sequence === jobsLoadSequence && principalId === kmsState.me?.principalId) loading.value = false;
  }
}

async function loadWorkerHealth() {
  const sequence = ++workerLoadSequence;
  const principalId = kmsState.me?.principalId;
  workerErrorMessage.value = '';
  health.value = null;
  if (!principalId) { workerLoading.value = false; return; }
  workerLoading.value = true;
  try {
    const worker = await loadKmsWorkerHealth();
    if (sequence === workerLoadSequence && principalId === kmsState.me?.principalId) health.value = worker;
  } catch (error) {
    if (sequence === workerLoadSequence && principalId === kmsState.me?.principalId) workerErrorMessage.value = error instanceof Error ? error.message : '读取 Worker 状态失败';
  } finally {
    if (sequence === workerLoadSequence && principalId === kmsState.me?.principalId) workerLoading.value = false;
  }
}

function selectPage(page: number) {
  currentPage.value = page;
  void loadJobs();
}

function selectPageSize(size: number) {
  pageSize.value = size;
  currentPage.value = 1;
  void loadJobs();
}

watch(() => kmsState.me?.principalId, () => {
  ++jobsLoadSequence;
  ++workerLoadSequence;
  totalElements.value = 0;
  currentPage.value = 1;
  ownerFilter.value = '';
  void loadJobs();
  void loadWorkerHealth();
}, { flush: 'sync' });
onMounted(() => { void loadJobs(); void loadWorkerHealth(); });
onBeforeUnmount(() => { ++jobsLoadSequence; ++workerLoadSequence; });
</script>

<template>
  <section class="kms-page">
    <PageHeader
      title="销毁任务"
      description="生命周期"
    />
    <p
      v-if="workerErrorMessage"
      class="kms-message danger"
      role="alert"
    >
      <span>{{ workerErrorMessage }}</span>
      <button
        type="button"
        class="button-secondary kms-retry-button"
        aria-label="重试 Worker 状态"
        :disabled="workerLoading"
        @click="() => void loadWorkerHealth()"
      >
        <RefreshCw
          :size="15"
          aria-hidden="true"
        />
        重试
      </button>
    </p>
    <section class="kms-health-band">
      <div>
        <strong>{{ healthSummary }}</strong>
        <span v-if="health">最近成功扫描：{{ time(health.lastSuccessfulScanAt) }} · 连续失败：{{ health.consecutiveFailureCount }}</span>
        <span v-else>最近成功扫描：未取得 · 连续失败：未取得</span>
      </div>
    </section>
    <section class="admin-data-surface">
      <div class="kms-toolbar">
        <input
          v-model.trim="ownerFilter"
          aria-label="按归属筛选"
          placeholder="iam:人员ID / aksk:客户端ID"
          @keyup.enter="searchJobs"
        >
        <button
          type="button"
          class="button-secondary"
          :disabled="loading"
          @click="searchJobs"
        >
          <Search
            :size="16"
            aria-hidden="true"
          />查询
        </button>
      </div>
      <div class="kms-surface-header">
        <h2>待处理与历史任务</h2>
        <span>{{ jobsLoaded ? `${totalElements} 项` : loading ? '读取中...' : '未取得任务总数' }}</span>
      </div>
      <p
        v-if="jobsErrorMessage"
        class="kms-message danger"
        role="alert"
      >
        <span>{{ jobsErrorMessage }}</span>
        <button
          type="button"
          class="button-secondary kms-retry-button"
          aria-label="重试销毁任务"
          :disabled="loading"
          @click="() => void loadJobs()"
        >
          <RefreshCw
            :size="15"
            aria-hidden="true"
          />
          重试
        </button>
      </p>
      <div
        class="kms-table-wrap"
        :aria-busy="loading"
      >
        <table class="responsive-table">
          <thead><tr><th>归属主体</th><th>密钥</th><th>版本</th><th>状态</th><th>计划时间</th><th>租约到期</th><th>尝试次数</th></tr></thead><tbody>
            <tr
              v-for="job in jobs"
              :key="`${job.keyRef}-${job.keyVersion}`"
            >
              <td>
                <span
                  v-if="principalSourceKind(job.ownerPrincipalId)"
                  class="status-badge neutral kms-owner-source"
                  :title="job.ownerPrincipalId"
                >{{ principalSourceText(principalSourceKind(job.ownerPrincipalId)) }}</span> {{ principalLabel(job.ownerPrincipalId, job.ownerDisplayName) }}
              </td><td><code>{{ job.keyRef }}</code></td><td>{{ job.keyVersion }}</td><td>
                <span
                  class="status-badge"
                  :class="job.state === 'COMPLETED' ? 'success' : job.state === 'CLAIMED' ? 'warning' : 'neutral'"
                >{{ job.state }}</span>
              </td><td>{{ time(job.dueAt) }}</td><td>{{ time(job.claimUntil) }}</td><td>{{ job.attemptCount }}</td>
            </tr><tr v-if="loading">
              <td
                colspan="7"
                class="kms-empty"
              >
                正在加载销毁任务...
              </td>
            </tr><tr v-else-if="jobsLoaded && jobs.length === 0">
              <td
                colspan="7"
                class="kms-empty"
              >
                {{ ownerFilter ? '当前筛选条件下没有销毁任务' : '当前没有销毁任务' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination
        :current="currentPage"
        :total="totalElements"
        :page-size="pageSize"
        :page-size-options="[20, 50, 100]"
        @update:current="selectPage"
        @update:page-size="selectPageSize"
      />
    </section>
  </section>
</template>
