<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { Plus, RefreshCw, Search } from 'lucide-vue-next';
import { createKmsKey, KmsApiError, listAdminKmsKeys, type KmsKey } from '../api/kmsApi';
import { keyAlgorithmLabel, keyPurposeLabel, keyStateLabel } from '../support/kmsDisplay';
import { principalLabel, principalSourceKind, principalSourceText, readableTime } from '../support/principal';
import { hasKmsApiPermission, kmsState } from '../kmsState';
import KeyDetails from '../components/KeyDetails.vue';

const keys = ref<KmsKey[]>([]);
const totalElements = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const totalPages = computed(() => Math.max(1, Math.ceil(totalElements.value / pageSize.value)));
const selected = ref<KmsKey | null>(null);
const selectedMode = ref<'self' | 'governance'>('governance');
const loading = ref(false);
const creating = ref(false);
const errorMessage = ref('');
const createErrorMessage = ref('');
const message = ref('');
const filter = reactive({ alias: '', state: '', ownerPrincipalId: '' });
const createForm = reactive({ keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
const createOpen = ref(false);
const createDialog = ref<HTMLElement | null>(null);
let keysLoadSequence = 0;
let createAttempt: { input: string; idempotencyKey: string } | null = null;
let active = true;
let identitySequence = 0;
let createSequence = 0;
const canReadKeys = computed(() => hasKmsApiPermission('kms.key.read'));
const canManageKeys = computed(() => hasKmsApiPermission('kms.key.manage'));

const keyColumns: DataTableColumn[] = [
  { key: 'keyAlias', label: '别名' },
  { key: 'ownerPrincipalId', label: '归属主体' },
  { key: 'purpose', label: '用途', width: '80px', nowrap: true },
  { key: 'algorithm', label: '算法', width: '148px', nowrap: true },
  { key: 'state', label: '状态', width: '100px', nowrap: true },
  { key: 'activeVersion', label: '活动版本', width: '100px', nowrap: true },
  { key: 'createdAt', label: '创建时间', width: '176px', nowrap: true },
  { key: 'actions', label: '操作', width: '112px', align: 'right', nowrap: true }
];
const emptyText = computed(() =>
  !canReadKeys.value
    ? '当前身份没有读取密钥的权限'
    : filter.alias || filter.state || filter.ownerPrincipalId
      ? '当前筛选条件下没有匹配的密钥'
      : '当前授权范围内暂无密钥'
);
const selectedKey = computed(() => selected.value?.keyRef ?? null);
const stateOptions = [
  { label: '全部状态', value: '' },
  { label: '活动', value: 'ACTIVE' },
  { label: '已停用', value: 'DISABLED' },
  { label: '待销毁', value: 'PENDING_DESTRUCTION' },
  { label: '已销毁', value: 'DESTROYED' }
];
const purposeOptions = [
  { label: '签名', value: 'SIGN' },
  { label: '加密', value: 'ENCRYPT' }
];

async function loadKeys() {
  const sequence = ++keysLoadSequence;
  const principalId = kmsState.me?.principalId;
  errorMessage.value = '';
  if (!principalId || !canReadKeys.value) { loading.value = false; return; }
  loading.value = true;
  try {
    const result = await listAdminKmsKeys({ page: currentPage.value, size: pageSize.value, alias: filter.alias || undefined, state: filter.state || undefined, ownerPrincipalId: filter.ownerPrincipalId.trim() || undefined });
    if (sequence !== keysLoadSequence || principalId !== kmsState.me?.principalId || !canReadKeys.value) return;
    totalElements.value = result.total;
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value;
      await loadKeys();
      return;
    }
    keys.value = result.items;
    if (selected.value) {
      const updated = result.items.find(item => item.keyRef === selected.value?.keyRef);
      if (updated) selected.value = updated;
    }
  } catch (error) {
    if (sequence === keysLoadSequence && principalId === kmsState.me?.principalId && canReadKeys.value) errorMessage.value = error instanceof Error ? error.message : '查询密钥失败';
  } finally {
    if (sequence === keysLoadSequence && principalId === kmsState.me?.principalId && canReadKeys.value) loading.value = false;
  }
}

function selectKey(key: KmsKey) { if (canReadKeys.value) { selected.value = key; selectedMode.value = 'governance'; } }
function searchKeys() { selected.value = null; currentPage.value = 1; void loadKeys(); }
function resetFilters() {
  Object.assign(filter, { alias: '', state: '', ownerPrincipalId: '' });
  searchKeys();
}
function changePage(page: number) { selected.value = null; currentPage.value = page; void loadKeys(); }
function changePageSize(size: number) { pageSize.value = size; searchKeys(); }

function openCreate() {
  if (!canManageKeys.value) return;
  createErrorMessage.value = '';
  message.value = '';
  Object.assign(createForm, { keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
  createAttempt = null;
  createOpen.value = true;
}
function closeCreate() { if (!creating.value) createOpen.value = false; }
function handleDialogKeydown(event: globalThis.KeyboardEvent) {
  if (event.key !== 'Escape' || !createOpen.value) return;
  // 浏览器可能在监听器间更新弹层状态，先消费事件，防止同一次 Escape 关闭下一层。
  event.preventDefault();
  event.stopImmediatePropagation();
  closeCreate();
}

async function submitCreate() {
  const principalId = kmsState.me?.principalId;
  const identity = identitySequence;
  if (creating.value || !canManageKeys.value || !createForm.keyAlias.trim() || !principalId || !createOpen.value) return;
  const sequence = ++createSequence;
  const isCurrent = () => active && sequence === createSequence && identity === identitySequence
    && principalId === kmsState.me?.principalId && canManageKeys.value;
  createErrorMessage.value = '';
  message.value = '';
  creating.value = true;
  const input = { ...createForm, keyAlias: createForm.keyAlias.trim() };
  const encoded = JSON.stringify(input);
  if (createAttempt?.input !== encoded) createAttempt = { input: encoded, idempotencyKey: crypto.randomUUID() };
  try {
    const created = await createKmsKey(input, createAttempt.idempotencyKey);
    if (!isCurrent()) return;
    createAttempt = null;
    createOpen.value = false;
    selected.value = canReadKeys.value ? created : null;
    // 创建属于当前主体；治理数据范围可能不包含本人，详情使用本人接口读取。
    selectedMode.value = 'self';
    Object.assign(filter, { alias: '', state: '', ownerPrincipalId: '' });
    currentPage.value = 1;
    createForm.keyAlias = '';
    message.value = '密钥已创建。';
    await loadKeys();
  } catch (error) {
    if (!isCurrent()) return;
    if (error instanceof KmsApiError && error.status >= 400 && error.status < 500) createAttempt = null;
    createErrorMessage.value = error instanceof Error ? error.message : '创建密钥失败';
  } finally { if (isCurrent()) creating.value = false; }
}

for (const [isOpen, dialog] of [[createOpen, createDialog]] as const) {
  let previousFocus: HTMLElement | null = null;
  watch(isOpen, async (value) => {
    if (!value) { previousFocus?.focus(); return; }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (isOpen.value) dialog.value?.focus();
  });
}

watch(canManageKeys, allowed => {
  if (allowed) return;
  ++createSequence;
  creating.value = false;
  createOpen.value = false;
  createAttempt = null;
  createErrorMessage.value = '';
  Object.assign(createForm, { keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
}, { flush: 'sync' });
watch([() => kmsState.me?.principalId, canReadKeys], ([principalId], previous) => {
  if (previous && principalId === previous[0]) {
    ++keysLoadSequence;
    keys.value = [];
    totalElements.value = 0;
    selected.value = null;
    loading.value = false;
    errorMessage.value = '';
    message.value = '';
    if (canReadKeys.value) void loadKeys();
    return;
  }
  ++identitySequence;
  ++createSequence;
  ++keysLoadSequence;
  keys.value = [];
  totalElements.value = 0;
  selected.value = null;
  selectedMode.value = 'governance';
  creating.value = false;
  createOpen.value = false;
  createAttempt = null;
  errorMessage.value = '';
  createErrorMessage.value = '';
  message.value = '';
  Object.assign(createForm, { keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
  Object.assign(filter, { alias: '', state: '', ownerPrincipalId: '' });
  currentPage.value = 1;
  void loadKeys();
}, { flush: 'sync' });
onMounted(() => { void loadKeys(); document.addEventListener('keydown', handleDialogKeydown); });
onBeforeUnmount(() => { active = false; ++keysLoadSequence; ++identitySequence; ++createSequence; document.removeEventListener('keydown', handleDialogKeydown); });
</script>

<template>
  <section class="kms-page">
    <header class="page-header kms-list-page-header">
      <div class="kms-title-line">
        <h1>密钥管理</h1>
      </div>
      <div class="page-header-actions">
        <button
          v-if="canManageKeys"
          class="button-primary"
          type="button"
          @click="openCreate"
        >
          <Plus
            :size="17"
            aria-hidden="true"
          />
          创建密钥
        </button>
      </div>
    </header>
    <p class="kms-page-subtitle">
      管理当前授权范围内的逻辑密钥、版本与生命周期。
    </p>
    <p
      v-if="errorMessage"
      class="admin-message error"
      role="alert"
    >
      <span>{{ errorMessage }}</span>
      <button
        type="button"
        class="button-secondary kms-retry-button"
        :disabled="loading || !canReadKeys"
        @click="() => void loadKeys()"
      >
        <RefreshCw
          :size="15"
          aria-hidden="true"
        />重试
      </button>
    </p>
    <p
      v-if="message"
      class="admin-message success"
      role="status"
    >
      {{ message }}
    </p>
    <div
      v-if="createOpen"
      class="dialog-backdrop"
      @click.self="closeCreate"
    >
      <section
        ref="createDialog"
        class="confirm-dialog kms-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="创建密钥"
        tabindex="-1"
      >
        <form
          class="kms-form"
          @submit.prevent="() => void submitCreate()"
        >
          <h2>创建密钥</h2>
          <p
            v-if="createErrorMessage"
            class="admin-message error"
            role="alert"
          >
            {{ createErrorMessage }}
          </p>
          <label>别名<input
            v-model.trim="createForm.keyAlias"
            :disabled="creating"
            required
            maxlength="128"
          ></label>
          <div class="kms-field">
            <span>用途</span><FormSelect
              v-model="createForm.purpose"
              :disabled="creating"
              aria-label="用途"
              :options="purposeOptions"
              @change="createForm.algorithm = createForm.purpose === 'SIGN' ? 'ES256' : 'AES_256_GCM'"
            />
          </div>
          <label>算法<input
            :value="createForm.algorithm === 'ES256' ? 'ES256' : 'AES-256-GCM'"
            readonly
          ></label>
          <footer class="kms-form-dialog-actions">
            <button
              type="button"
              class="button-secondary"
              :disabled="creating"
              @click="closeCreate"
            >
              取消
            </button>
            <button
              type="submit"
              class="button-primary"
              :disabled="creating || !createForm.keyAlias"
            >
              {{ creating ? '创建中...' : '创建' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
    <section class="panel kms-list-panel">
      <div class="kms-panel-heading">
        <h2>密钥列表 <span v-if="!loading && !errorMessage">{{ totalElements }}</span></h2>
      </div>
      <form
        class="kms-filters"
        @submit.prevent="searchKeys"
      >
        <label>别名
          <input
            v-model="filter.alias"
            type="search"
            aria-label="按别名筛选"
            placeholder="全部别名"
          >
        </label>
        <div class="kms-filter-field">
          <span>状态</span>
          <FormSelect
            v-model="filter.state"
            aria-label="按状态筛选"
            :options="stateOptions"
          />
        </div>
        <label class="kms-filter-owner">归属主体
          <input
            v-model.trim="filter.ownerPrincipalId"
            type="search"
            aria-label="按归属筛选"
            placeholder="iam:人员ID / aksk:客户端ID"
          >
        </label>
        <div class="kms-filter-actions">
          <button
            type="submit"
            class="button-primary"
            :disabled="loading || !canReadKeys"
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
      <DataTable
        v-if="keys.length > 0 || loading"
        :columns="keyColumns"
        :rows="keys"
        row-key="keyRef"
        :loading="loading"
        :empty-text="emptyText"
        :selected-key="selectedKey"
        scroll-min-width="1080px"
        row-selectable
        @row-select="row => selectKey(row)"
      >
        <template #cell-ownerPrincipalId="{ row }">
          <span
            v-if="principalSourceKind(row.ownerPrincipalId)"
            class="status-badge neutral kms-owner-source"
            :title="row.ownerPrincipalId"
          >{{ principalSourceText(principalSourceKind(row.ownerPrincipalId)) }}</span>
          {{ principalLabel(row.ownerPrincipalId, row.ownerDisplayName) }}
        </template>
        <template #cell-state="{ row }">
          <span
            class="status-badge"
            :class="row.state === 'ACTIVE' ? 'success' : row.state === 'PENDING_DESTRUCTION' ? 'warning' : 'neutral'"
          >{{ keyStateLabel(row.state) }}</span>
        </template>
        <template #cell-purpose="{ row }">
          {{ keyPurposeLabel(row.purpose) }}
        </template>
        <template #cell-algorithm="{ row }">
          {{ keyAlgorithmLabel(row.algorithm) }}
        </template>
        <template #cell-activeVersion="{ row }">
          {{ row.activeVersion ?? '-' }}
        </template>
        <template #cell-createdAt="{ row }">
          {{ readableTime(row.createdAt) }}
        </template>
        <template #cell-actions="{ row }">
          <button
            type="button"
            class="table-action kms-view-detail"
            title="查看详情"
            :aria-label="`打开${row.keyAlias}详情`"
            @click="selectKey(row)"
          >
            查看详情
          </button>
        </template>
      </DataTable>
      <p
        v-else-if="!errorMessage"
        class="data-table-placeholder"
        role="status"
      >
        {{ loading ? '正在加载密钥…' : emptyText }}
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
          @update:current="changePage"
          @update:page-size="changePageSize"
        />
      </div>
    </section>
    <KeyDetails
      v-if="selected"
      :key-ref="selected.keyRef"
      :mode="selectedMode"
      :initial-key="selected"
      :policy-editable="false"
      @changed="() => void loadKeys()"
      @close="selected = null"
    />
  </section>
</template>
