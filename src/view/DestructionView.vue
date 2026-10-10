<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { principalLabel, principalSourceKind, principalSourceText } from '../support/principal';
import { RefreshCw, Search } from 'lucide-vue-next';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { listKmsDestructionJobs, loadKmsWorkerHealth, type KmsDestructionJob, type KmsWorkerHealth } from '../api/kmsApi';
import { kmsState } from '../kmsState';
import { destructionStateLabel } from '../support/kmsDisplay';

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

const jobColumns: DataTableColumn[] = [
  { key: 'ownerPrincipalId', label: '归属主体' },
  { key: 'keyRef', label: '密钥' },
  { key: 'keyVersion', label: '版本', width: '80px', nowrap: true },
  { key: 'state', label: '状态', width: '100px', nowrap: true },
  { key: 'dueAt', label: '计划时间', width: '176px', nowrap: true },
  { key: 'claimUntil', label: '租约到期', width: '176px', nowrap: true },
  { key: 'completedAt', label: '完成时间', width: '176px', nowrap: true },
  { key: 'attemptCount', label: '尝试次数', width: '100px', nowrap: true }
];
const emptyText = computed(() => ownerFilter.value ? '当前筛选条件下没有销毁任务' : '当前没有销毁任务');
// 契约 DataTable 的 rowKey 收单字段；销毁任务的唯一性是 keyRef+keyVersion 组合，宿主派生展开
const jobRows = computed(() => jobs.value.map(job => ({ ...job, jobId: `${job.keyRef}-${job.keyVersion}` })));
function searchJobs() { currentPage.value = 1; void loadJobs(); }
function resetFilters() {
  ownerFilter.value = '';
  searchJobs();
}
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
    <header class="page-header kms-list-page-header">
      <div class="kms-title-line">
        <h1>销毁任务</h1>
      </div>
      <div class="page-header-actions">
        <div class="kms-worker-summary">
          <strong>{{ healthSummary }}</strong>
          <span v-if="health">最近成功扫描：{{ time(health.lastSuccessfulScanAt) }} · 连续失败：{{ health.consecutiveFailureCount }}</span>
          <span v-else>最近成功扫描：未取得 · 连续失败：未取得</span>
        </div>
      </div>
    </header>
    <p class="kms-page-subtitle">
      查看密钥销毁任务、执行进度和 Worker 运行状态。
    </p>
    <p
      v-if="workerErrorMessage"
      class="admin-message error"
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
    <section class="panel kms-list-panel">
      <div class="kms-panel-heading">
        <h2>任务列表 <span v-if="jobsLoaded && !jobsErrorMessage">{{ totalElements }}</span></h2>
      </div>
      <form
        class="kms-filters"
        @submit.prevent="searchJobs"
      >
        <label class="kms-filter-owner">归属主体
          <input
            v-model.trim="ownerFilter"
            type="search"
            aria-label="按归属筛选"
            placeholder="iam:人员ID / aksk:客户端ID"
          >
        </label>
        <div class="kms-filter-actions">
          <button
            type="submit"
            class="button-primary"
            :disabled="loading"
          >
            <Search
              :size="16"
              aria-hidden="true"
            />查询
          </button>
          <button
            type="button"
            class="button-secondary"
            :disabled="loading"
            @click="resetFilters"
          >
            重置
          </button>
        </div>
      </form>
      <p
        v-if="jobsErrorMessage"
        class="admin-message error"
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
      <DataTable
        v-if="jobRows.length > 0 || loading"
        :columns="jobColumns"
        :rows="jobRows"
        row-key="jobId"
        :loading="loading"
        :empty-text="emptyText"
        scroll-min-width="1000px"
      >
        <template #cell-ownerPrincipalId="{ row }">
          <span
            v-if="principalSourceKind(row.ownerPrincipalId)"
            class="status-badge neutral kms-owner-source"
            :title="row.ownerPrincipalId"
          >{{ principalSourceText(principalSourceKind(row.ownerPrincipalId)) }}</span>
          {{ principalLabel(row.ownerPrincipalId, row.ownerDisplayName) }}
        </template>
        <template #cell-keyRef="{ row }">
          <code>{{ row.keyRef }}</code>
        </template>
        <template #cell-state="{ row }">
          <span
            class="status-badge"
            :class="row.state === 'COMPLETED' ? 'success' : row.state === 'CLAIMED' ? 'warning' : 'neutral'"
          >{{ destructionStateLabel(row.state) }}</span>
        </template>
        <template #cell-dueAt="{ row }">
          {{ time(row.dueAt) }}
        </template>
        <template #cell-claimUntil="{ row }">
          {{ time(row.claimUntil) }}
        </template>
        <template #cell-completedAt="{ row }">
          {{ time(row.completedAt) }}
        </template>
      </DataTable>
      <p
        v-else-if="!jobsErrorMessage"
        class="data-table-placeholder"
        role="status"
      >
        {{ loading ? '正在加载销毁任务…' : emptyText }}
      </p>
      <div
        v-if="totalElements > 0"
        class="kms-pagination-row"
        :inert="loading"
      >
        <Pagination
          :current="currentPage"
          :total="totalElements"
          :page-size="pageSize"
          @update:current="selectPage"
          @update:page-size="selectPageSize"
        />
      </div>
    </section>
  </section>
</template>
