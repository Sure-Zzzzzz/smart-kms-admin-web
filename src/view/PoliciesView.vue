<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { principalLabel, principalSourceKind, principalSourceText, readableTime } from '../support/principal';
import { Plus, RefreshCw, Search, Trash2 } from 'lucide-vue-next';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { createKmsPolicy, KmsApiError, listAdminKmsKeys, listAdminKmsPolicies, revokeKmsPolicy, type KmsAdminPolicy, type KmsKey } from '../api/kmsApi';
import { hasKmsApiPermission, kmsState } from '../kmsState';
import { policyOperationLabel } from '../support/kmsDisplay';

// 主列表：治理视角全量策略分页；创建走弹窗：搜索并锚定一把密钥后授予。
const policies = ref<KmsAdminPolicy[]>([]);
const currentPage = ref(1);
const pageSize = ref(20);
const totalElements = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(totalElements.value / pageSize.value)));
const filter = reactive({ alias: '', principalId: '', operation: '' });
const loading = ref(false);
const errorMessage = ref('');
const message = ref('');
const canManagePolicies = computed(() => hasKmsApiPermission('kms.key.policy'));

const policyColumns: DataTableColumn[] = [
  { key: 'keyAlias', label: '密钥' },
  { key: 'ownerPrincipalId', label: '归属主体' },
  { key: 'principalId', label: '被授权主体' },
  { key: 'keyVersion', label: '版本', width: '80px', nowrap: true },
  { key: 'operation', label: '授权操作', width: '112px', nowrap: true },
  { key: 'expiresAt', label: '到期时间', width: '176px', nowrap: true },
  { key: 'actions', label: '操作', width: '90px', align: 'right', nowrap: true }
];
const operationFilterOptions = [
  { label: '全部操作', value: '' },
  { label: '签名', value: 'SIGN' },
  { label: '验签', value: 'VERIFY' },
  { label: '加密', value: 'ENCRYPT' },
  { label: '解密', value: 'DECRYPT' },
  { label: '读取公钥', value: 'READ_PUBLIC_KEY' }
];
let policyLoadSequence = 0;
let active = true;
let identitySequence = 0;
const emptyText = computed(() =>
  !canManagePolicies.value
    ? '当前身份没有读取策略的权限'
    : filter.alias || filter.principalId || filter.operation
      ? '当前筛选条件下没有匹配的策略'
      : '当前授权范围内暂无策略'
);

// 创建弹窗：密钥搜索与选择
const createOpen = ref(false);
const createDialog = ref<HTMLElement | null>(null);
const keys = ref<KmsKey[]>([]);
const keySearchAlias = ref('');
const keysLoading = ref(false);
const createKeyRef = ref('');
const submitting = ref(false);
const createErrorMessage = ref('');
const form = reactive({ principalId: '', keyVersion: '', operation: 'SIGN', expiresAt: '' });
let keysLoadSequence = 0;
let createSequence = 0;
const selectedKey = computed(() => keys.value.find(key => key.keyRef === createKeyRef.value));
const keyOptions = computed(() => [
  { label: '选择密钥', value: '' },
  ...keys.value.map(key => ({ label: `${key.keyAlias} · ${principalLabel(key.ownerPrincipalId, key.ownerDisplayName)} · ${key.keyRef}`, value: key.keyRef }))
]);
const operationOptions = computed(() => !selectedKey.value ? [] : selectedKey.value.purpose === 'SIGN'
  ? [{ label: '签名', value: 'SIGN' }, { label: '验签', value: 'VERIFY' }, { label: '读取公钥', value: 'READ_PUBLIC_KEY' }]
  : [{ label: '加密', value: 'ENCRYPT' }, { label: '解密', value: 'DECRYPT' }]);

// 撤销确认
const revokeTarget = ref<{ policy: KmsAdminPolicy; principalId: string; idempotencyKey: string } | null>(null);
const revokeErrorMessage = ref('');

function requestKey() { return crypto.randomUUID(); }

async function loadPolicies() {
  const sequence = ++policyLoadSequence;
  const principalId = kmsState.me?.principalId;
  policies.value = [];
  errorMessage.value = '';
  loading.value = Boolean(principalId && canManagePolicies.value);
  if (!principalId || !canManagePolicies.value) { loading.value = false; return; }
  try {
    const result = await listAdminKmsPolicies({
      page: currentPage.value,
      size: pageSize.value,
      keyAlias: filter.alias.trim() || undefined,
      principalId: filter.principalId.trim() || undefined,
      operation: filter.operation || undefined
    });
    if (sequence !== policyLoadSequence || principalId !== kmsState.me?.principalId) return;
    totalElements.value = result.total;
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value;
      await loadPolicies();
      return;
    }
    policies.value = result.items;
  } catch (error) {
    if (sequence === policyLoadSequence && principalId === kmsState.me?.principalId) {
      errorMessage.value = error instanceof Error ? error.message : '读取策略失败';
    }
  } finally {
    if (sequence === policyLoadSequence && principalId === kmsState.me?.principalId) loading.value = false;
  }
}

function searchPolicies() { currentPage.value = 1; void loadPolicies(); }
function resetFilters() {
  Object.assign(filter, { alias: '', principalId: '', operation: '' });
  searchPolicies();
}
function selectPage(page: number) { currentPage.value = page; void loadPolicies(); }
function selectPageSize(size: number) { pageSize.value = size; searchPolicies(); }

async function loadKeys() {
  const sequence = ++keysLoadSequence;
  const principalId = kmsState.me?.principalId;
  if (createKeyRef.value) { createKeyRef.value = ''; resetForm(); }
  keys.value = [];
  createErrorMessage.value = '';
  if (!principalId || !canManagePolicies.value) { keysLoading.value = false; return; }
  keysLoading.value = true;
  try {
    const result = await listAdminKmsKeys({ page: 1, size: 100, alias: keySearchAlias.value.trim() || undefined });
    if (sequence !== keysLoadSequence || principalId !== kmsState.me?.principalId) return;
    keys.value = result.items;
  } catch (error) {
    if (sequence === keysLoadSequence && principalId === kmsState.me?.principalId) {
      createErrorMessage.value = error instanceof Error ? error.message : '读取密钥失败';
    }
  } finally {
    if (sequence === keysLoadSequence && principalId === kmsState.me?.principalId) keysLoading.value = false;
  }
}

function resetForm() {
  Object.assign(form, { principalId: '', keyVersion: '', operation: selectedKey.value?.purpose === 'ENCRYPT' ? 'ENCRYPT' : 'SIGN', expiresAt: '' });
}
function selectCreateKey() { createErrorMessage.value = ''; resetForm(); }

function openCreate() {
  if (!canManagePolicies.value) return;
  createErrorMessage.value = '';
  message.value = '';
  Object.assign(form, { principalId: '', keyVersion: '', operation: 'SIGN', expiresAt: '' });
  createKeyRef.value = '';
  keySearchAlias.value = '';
  createRequestState = null;
  createOpen.value = true;
  void loadKeys();
}
function closeCreate() { if (!submitting.value) createOpen.value = false; }
function handleDialogKeydown(event: globalThis.KeyboardEvent) {
  if (event.key !== 'Escape' || (!createOpen.value && revokeTarget.value === null)) return;
  // 浏览器可能在监听器间更新弹层状态，先消费事件，防止同一次 Escape 关闭下一层。
  event.preventDefault();
  event.stopImmediatePropagation();
  if (revokeTarget.value !== null) revokeTarget.value = null;
  else closeCreate();
}

async function submitCreate() {
  const principalId = kmsState.me?.principalId;
  const identity = identitySequence;
  if (!selectedKey.value || submitting.value || !canManagePolicies.value || !principalId || !createOpen.value) return;
  if (!form.principalId.trim() || !operationOptions.value.some(option => option.value === form.operation)
    || (form.keyVersion !== '' && (!Number.isSafeInteger(Number(form.keyVersion)) || Number(form.keyVersion) < 1))
    || (form.expiresAt !== '' && !Number.isFinite(new Date(form.expiresAt).getTime()))) {
    createErrorMessage.value = '策略参数无效：需填写主体、有效版本和该密钥支持的操作。';
    return;
  }
  const targetKeyRef = createKeyRef.value;
  const sequence = ++createSequence;
  createErrorMessage.value = '';
  message.value = '';
  submitting.value = true;
  const input = {
    principalId: form.principalId,
    keyVersion: form.keyVersion ? Number(form.keyVersion) : undefined,
    operation: form.operation,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined
  };
  const signature = JSON.stringify([targetKeyRef, input]);
  if (createRequestState?.signature !== signature) createRequestState = { signature, idempotencyKey: requestKey() };
  try {
    await createKmsPolicy(targetKeyRef, input, createRequestState.idempotencyKey);
    if (!active || identity !== identitySequence || principalId !== kmsState.me?.principalId || sequence !== createSequence) return;
    createRequestState = null;
    createOpen.value = false;
    message.value = '策略已创建。';
    await loadPolicies();
  } catch (error) {
    if (!active || identity !== identitySequence || principalId !== kmsState.me?.principalId || sequence !== createSequence) return;
    if (error instanceof KmsApiError && error.status >= 400 && error.status < 500) createRequestState = null;
    createErrorMessage.value = error instanceof Error ? error.message : '创建策略失败';
  } finally {
    if (active && identity === identitySequence && sequence === createSequence) submitting.value = false;
  }
}
let createRequestState: { signature: string; idempotencyKey: string } | null = null;

function requestRevoke(policy: KmsAdminPolicy) {
  const principalId = kmsState.me?.principalId;
  if (submitting.value || loading.value || !canManagePolicies.value || !principalId) return;
  revokeErrorMessage.value = '';
  revokeTarget.value = { policy: { ...policy }, principalId, idempotencyKey: requestKey() };
}

async function submitRevoke() {
  const target = revokeTarget.value;
  const identity = identitySequence;
  if (!target || submitting.value || !canManagePolicies.value || target.principalId !== kmsState.me?.principalId) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  revokeErrorMessage.value = '';
  try {
    await revokeKmsPolicy(target.policy.keyRef, target.policy.policyId, target.policy.rowVersion, target.idempotencyKey);
    if (!active || identity !== identitySequence || target.principalId !== kmsState.me?.principalId) return;
    revokeTarget.value = null;
    message.value = `密钥 ${target.policy.keyRef} 的策略已撤销。`;
    await loadPolicies();
  } catch (error) {
    if (!active || identity !== identitySequence || target.principalId !== kmsState.me?.principalId) return;
    revokeErrorMessage.value = error instanceof Error ? error.message : '';
    errorMessage.value = revokeErrorMessage.value || '撤销策略失败，请重试。';
    if (error instanceof KmsApiError && error.status >= 400 && error.status < 500) target.idempotencyKey = requestKey();
    if (error instanceof KmsApiError && error.status === 409) {
      revokeTarget.value = null;
      await loadPolicies();
      errorMessage.value += '。策略已被他人变更，列表已重新读取，请重新确认撤销。';
    }
  } finally {
    if (active && identity === identitySequence && target.principalId === kmsState.me?.principalId) submitting.value = false;
  }
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

watch(() => kmsState.me?.principalId, () => {
  ++identitySequence;
  ++policyLoadSequence;
  ++keysLoadSequence;
  ++createSequence;
  policies.value = [];
  keys.value = [];
  totalElements.value = 0;
  currentPage.value = 1;
  Object.assign(filter, { alias: '', principalId: '', operation: '' });
  keySearchAlias.value = '';
  createKeyRef.value = '';
  createOpen.value = false;
  submitting.value = false;
  revokeTarget.value = null;
  revokeErrorMessage.value = '';
  createRequestState = null;
  errorMessage.value = '';
  createErrorMessage.value = '';
  resetForm();
}, { flush: 'sync' });
onMounted(() => { void loadPolicies(); document.addEventListener('keydown', handleDialogKeydown); });
onBeforeUnmount(() => { active = false; ++policyLoadSequence; ++keysLoadSequence; ++identitySequence; ++createSequence; document.removeEventListener('keydown', handleDialogKeydown); });
</script>

<template>
  <section class="kms-page">
    <header class="page-header kms-list-page-header">
      <div class="kms-title-line">
        <h1>策略</h1>
      </div>
      <div class="page-header-actions">
        <button
          v-if="canManagePolicies"
          class="button-primary"
          type="button"
          @click="openCreate"
        >
          <Plus
            :size="17"
            aria-hidden="true"
          />
          创建策略
        </button>
      </div>
    </header>
    <p class="kms-page-subtitle">
      按密钥、主体、版本和操作维护精确授权策略。
    </p>
    <p
      v-if="errorMessage"
      class="admin-message error"
      role="alert"
    >
      <span>{{ errorMessage }}</span>
      <button
        class="button-secondary kms-retry-button"
        type="button"
        :disabled="loading"
        @click="() => void loadPolicies()"
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
        aria-label="创建策略"
        tabindex="-1"
      >
        <form
          class="kms-form"
          @submit.prevent="() => void submitCreate()"
        >
          <h2>创建策略</h2>
          <p
            v-if="createErrorMessage"
            class="admin-message error"
            role="alert"
          >
            {{ createErrorMessage }}
          </p>
          <div class="kms-field">
            <span>目标密钥</span>
            <div class="kms-toolbar">
              <input
                v-model="keySearchAlias"
                aria-label="按别名查找密钥"
                placeholder="密钥别名"
                :disabled="keysLoading || submitting"
                @keyup.enter="() => void loadKeys()"
              >
              <button
                type="button"
                class="button-secondary"
                :disabled="keysLoading || submitting"
                @click="() => void loadKeys()"
              >
                <Search
                  :size="16"
                  aria-hidden="true"
                />{{ keysLoading ? '查找中...' : '查找' }}
              </button>
            </div><FormSelect
              v-model="createKeyRef"
              aria-label="选择密钥"
              :options="keyOptions"
              :disabled="keysLoading || submitting"
              @change="selectCreateKey"
            />
            <p
              v-if="!keysLoading && keys.length === 0"
              class="kms-policy-hint"
            >
              没有匹配的密钥，换个别名再查找。
            </p>
          </div><label>主体标识<input
            v-model.trim="form.principalId"
            required
            :disabled="submitting || !createKeyRef"
            placeholder="iam:人员ID / aksk:客户端ID"
          ></label><label>版本<input
            v-model="form.keyVersion"
            type="number"
            min="1"
            step="1"
            placeholder="全部版本（含后续轮换）"
            :disabled="submitting || !createKeyRef"
          ></label><div class="kms-field">
            <span>操作</span><FormSelect
              v-model="form.operation"
              aria-label="操作"
              :options="operationOptions"
              :disabled="submitting || !createKeyRef"
            />
          </div><label>到期时间<input
            v-model="form.expiresAt"
            type="datetime-local"
            :disabled="submitting || !createKeyRef"
          ></label>
          <p
            v-if="createKeyRef && form.operation === 'READ_PUBLIC_KEY'"
            class="kms-policy-hint"
          >
            公钥列表需要全部可分发版本的读取授权。版本留空会授权该密钥的全部版本，包括后续轮换版本；指定版本时，需为各版本分别配置策略。到期时间留空表示长期有效。
          </p>
          <footer class="kms-form-dialog-actions">
            <button
              type="button"
              class="button-secondary"
              :disabled="submitting"
              @click="closeCreate"
            >
              取消
            </button>
            <button
              type="submit"
              class="button-primary"
              :disabled="submitting || loading || keysLoading || !createKeyRef || !form.principalId"
            >
              {{ submitting ? '创建中...' : '创建策略' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
    <section class="panel kms-list-panel">
      <div class="kms-panel-heading">
        <h2>策略列表 <span v-if="!loading && !errorMessage">{{ totalElements }}</span></h2>
      </div>
      <form
        class="kms-filters"
        @submit.prevent="searchPolicies"
      >
        <label>密钥别名
          <input
            v-model="filter.alias"
            type="search"
            aria-label="按密钥别名筛选"
            placeholder="全部密钥"
          >
        </label>
        <label class="kms-filter-owner">被授权主体
          <input
            v-model.trim="filter.principalId"
            type="search"
            aria-label="按被授权主体筛选"
            placeholder="iam:人员ID / aksk:客户端ID"
          >
        </label>
        <div class="kms-filter-field">
          <span>操作</span>
          <FormSelect
            v-model="filter.operation"
            aria-label="按操作筛选"
            :options="operationFilterOptions"
          />
        </div>
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
      <DataTable
        v-if="policies.length > 0 || loading"
        :columns="policyColumns"
        :rows="policies"
        row-key="policyId"
        :loading="loading"
        :empty-text="emptyText"
        scroll-min-width="1100px"
      >
        <template #cell-keyAlias="{ row }">
          <code :title="row.keyRef">{{ row.keyAlias }}</code>
        </template>
        <template #cell-ownerPrincipalId="{ row }">
          <span
            v-if="principalSourceKind(row.ownerPrincipalId)"
            class="status-badge neutral kms-owner-source"
            :title="row.ownerPrincipalId"
          >{{ principalSourceText(principalSourceKind(row.ownerPrincipalId)) }}</span>
          {{ principalLabel(row.ownerPrincipalId, row.ownerDisplayName) }}
        </template>
        <template #cell-principalId="{ row }">
          <span
            v-if="principalSourceKind(row.principalId)"
            class="status-badge neutral kms-owner-source"
            :title="row.principalId"
          >{{ principalSourceText(principalSourceKind(row.principalId)) }}</span>
          {{ principalLabel(row.principalId, row.principalDisplayName) }}
        </template>
        <template #cell-keyVersion="{ row }">
          {{ row.keyVersion ?? '全部' }}
        </template>
        <template #cell-operation="{ row }">
          {{ policyOperationLabel(row.operation) }}
        </template>
        <template #cell-expiresAt="{ row }">
          {{ row.expiresAt ? readableTime(row.expiresAt) : '长期有效' }}
        </template>
        <template #cell-actions="{ row }">
          <button
            v-if="canManagePolicies"
            type="button"
            class="table-action kms-danger-action"
            :disabled="submitting || loading"
            aria-label="撤销策略"
            @click="requestRevoke(row)"
          >
            <Trash2
              :size="16"
              aria-hidden="true"
            />撤销
          </button>
        </template>
      </DataTable>
      <p
        v-else-if="!errorMessage"
        class="data-table-placeholder"
        role="status"
      >
        {{ loading ? '正在加载策略…' : emptyText }}
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
    <Dialog
      :open="revokeTarget !== null"
      title="撤销密钥策略"
      :description="revokeErrorMessage || `撤销密钥 ${revokeTarget?.policy.keyRef} 对主体 ${principalLabel(revokeTarget?.policy.principalId, revokeTarget?.policy.principalDisplayName)} 的策略后，该主体将不能再使用此策略授权。是否继续？`"
      confirm-label="撤销策略"
      :pending="submitting"
      @close="revokeTarget = null"
      @confirm="() => void submitRevoke()"
    />
  </section>
</template>
