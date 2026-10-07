<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { readableTime } from '../support/principal';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import { RefreshCw, Search } from 'lucide-vue-next';
import { createKmsKey, listMyKmsKeys, loadMyDestructionPolicy, saveMyDestructionPolicy, type KmsKey } from '../api/kmsApi';
import { hasKmsApiPermission, kmsState } from '../kmsState';
import KeyDetails from '../components/KeyDetails.vue';

const keys = ref<KmsKey[]>([]);
const totalElements = ref(0);
const currentPage = ref(1);
const pageSize = ref(100);
const totalPages = computed(() => Math.max(1, Math.ceil(totalElements.value / pageSize.value)));
const selectedKeyRef = ref('');
const selectedKey = ref<KmsKey>();
const message = ref('');
const policyRevision = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const filter = reactive({ alias: '', state: '' });
let keysLoadSequence = 0;
let active = true;
let identitySequence = 0;
const canReadKeys = computed(() => hasKmsApiPermission('kms.key.read'));
const canManageKeys = computed(() => hasKmsApiPermission('kms.key.manage'));
const canManageDestruction = computed(() => hasKmsApiPermission('kms.key.destroy'));

const createOpen = ref(false);
const createDialog = ref<HTMLElement | null>(null);
const creating = ref(false);
const createErrorMessage = ref('');
const createRequestKey = ref('');
const createRequestBody = ref('');
const createForm = reactive({ keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
let createSequence = 0;
const stateOptions = [
  { label: '全部状态', value: '' },
  { label: '活动', value: 'ACTIVE' },
  { label: '已停用', value: 'DISABLED' },
  { label: '待销毁', value: 'PENDING_DESTRUCTION' },
  { label: '已销毁', value: 'DESTROYED' }
];
const purposeOptions = [
  { label: '签名（SIGN）', value: 'SIGN' },
  { label: '加解密（ENCRYPT）', value: 'ENCRYPT' }
];
const createAlgorithmOptions = computed(() =>
  createForm.purpose === 'SIGN'
    ? [{ label: 'ES256（非对称）', value: 'ES256' }]
    : [{ label: 'AES-256-GCM（对称）', value: 'AES_256_GCM' }]);
watch(() => createForm.purpose, (purpose) => {
  createForm.algorithm = purpose === 'SIGN' ? 'ES256' : 'AES_256_GCM';
});

function requestKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function openCreate() {
  if (!canManageKeys.value) return;
  createErrorMessage.value = '';
  message.value = '';
  Object.assign(createForm, { keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
  createRequestKey.value = requestKey();
  createRequestBody.value = '';
  createOpen.value = true;
}

async function submitCreate() {
  const principalId = kmsState.me?.principalId;
  const identity = identitySequence;
  if (!createOpen.value || !canManageKeys.value || !createForm.keyAlias.trim() || creating.value || !principalId) return;
  const sequence = ++createSequence;
  const isCurrent = () => active && sequence === createSequence && identity === identitySequence
    && principalId === kmsState.me?.principalId && canManageKeys.value;
  creating.value = true;
  createErrorMessage.value = '';
  errorMessage.value = '';
  try {
    const input = { keyAlias: createForm.keyAlias.trim(), purpose: createForm.purpose, algorithm: createForm.algorithm };
    const body = JSON.stringify(input);
    if (body !== createRequestBody.value) {
      createRequestKey.value = requestKey();
      createRequestBody.value = body;
    }
    const created = await createKmsKey(input, createRequestKey.value);
    if (!isCurrent()) return;
    Object.assign(filter, { alias: '', state: '' });
    currentPage.value = 1;
    if (canReadKeys.value) {
      selectedKey.value = { ...created, ownerPrincipalId: created.ownerPrincipalId ?? principalId };
      selectedKeyRef.value = created.keyRef;
    }
    message.value = '密钥已创建。';
    createOpen.value = false;
    await loadKeys();
  } catch (error) {
    if (!isCurrent()) return;
    createErrorMessage.value = error instanceof Error ? error.message : '创建失败';
  } finally {
    if (isCurrent()) creating.value = false;
  }
}

async function loadKeys() {
  const sequence = ++keysLoadSequence;
  const principalId = kmsState.me?.principalId;
  if (!principalId || !canReadKeys.value) { loading.value = false; return; }
  loading.value = true;
  errorMessage.value = '';
  try {
    const page = await listMyKmsKeys({ page: currentPage.value, size: pageSize.value, alias: filter.alias || undefined, state: filter.state || undefined });
    if (sequence !== keysLoadSequence || principalId !== kmsState.me?.principalId || !canReadKeys.value) return;
    keys.value = page.items;
    totalElements.value = page.total;
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value;
      await loadKeys();
      return;
    }
    if (selectedKeyRef.value) {
      const selected = page.items.find(key => key.keyRef === selectedKeyRef.value);
      if (selected) selectedKey.value = selected;
    }
  } catch (error) {
    if (sequence === keysLoadSequence && principalId === kmsState.me?.principalId && canReadKeys.value) errorMessage.value = error instanceof Error ? error.message : '查询失败';
  } finally {
    if (sequence === keysLoadSequence && principalId === kmsState.me?.principalId && canReadKeys.value) loading.value = false;
  }
}

function selectKey(key: KmsKey) { if (canReadKeys.value) { selectedKey.value = key; selectedKeyRef.value = key.keyRef; } }
function closeDetails() { selectedKeyRef.value = ''; selectedKey.value = undefined; }
function searchKeys() { currentPage.value = 1; void loadKeys(); }
function selectPage(page: number) { currentPage.value = page; void loadKeys(); }
function selectPageSize(size: number) { pageSize.value = size; searchKeys(); }

const policyOpen = ref(false);
const policyDialog = ref<HTMLElement | null>(null);
const policySaving = ref(false);
const policyLoading = ref(false);
const policyErrorMessage = ref('');
const policyReadFailed = ref(false);
const policyForm = reactive({ minHours: '', maxHours: '' });
const maxDestructionAheadSeconds = 315_360_000;
let policyReadSequence = 0;
let policyWriteSequence = 0;

function closeCreate() { if (!creating.value) createOpen.value = false; }
function closePolicy() {
  if (policySaving.value) return;
  policyOpen.value = false;
  ++policyReadSequence;
}
function handleDialogKeydown(event: globalThis.KeyboardEvent) {
  if (event.key !== 'Escape' || (!policyOpen.value && !createOpen.value)) return;
  // 浏览器可能在监听器间更新弹层状态，先消费事件，防止同一次 Escape 关闭下一层。
  event.preventDefault();
  event.stopImmediatePropagation();
  if (policyOpen.value) closePolicy();
  else closeCreate();
}

for (const [isOpen, dialog] of [[createOpen, createDialog], [policyOpen, policyDialog]] as const) {
  let previousFocus: HTMLElement | null = null;
  watch(isOpen, async (value) => {
    if (!value) { previousFocus?.focus(); return; }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (isOpen.value) dialog.value?.focus();
  });
}

function openPolicy() {
  if (!canManageDestruction.value) return;
  Object.assign(policyForm, { minHours: '', maxHours: '' });
  policyErrorMessage.value = '';
  policyReadFailed.value = false;
  const readSequence = ++policyReadSequence;
  policyOpen.value = true;
  // 回读完成前禁用编辑和保存，避免旧政策覆盖用户的新输入。
  policyLoading.value = true;
  void loadPolicy(readSequence);
}

async function loadPolicy(readSequence: number) {
  const principalId = kmsState.me?.principalId;
  const isCurrent = () => active && readSequence === policyReadSequence && policyOpen.value
    && principalId === kmsState.me?.principalId && canManageDestruction.value;
  try {
    const policy = await loadMyDestructionPolicy();
    if (!isCurrent()) return;
    if (policy.exists) {
      policyForm.minHours = policy.minScheduleAheadSeconds === null ? '' : String(policy.minScheduleAheadSeconds / 3600);
      policyForm.maxHours = policy.maxScheduleAheadSeconds === null ? '' : String(policy.maxScheduleAheadSeconds / 3600);
    }
  } catch (error) {
    if (!isCurrent()) return;
    policyReadFailed.value = true;
    policyErrorMessage.value = error instanceof Error ? error.message : '读取销毁窗口政策失败';
  } finally {
    if (isCurrent()) policyLoading.value = false;
  }
}

async function submitPolicy() {
  const principalId = kmsState.me?.principalId;
  const identity = identitySequence;
  if (!policyOpen.value || !canManageDestruction.value || policySaving.value || policyLoading.value || policyReadFailed.value || !principalId) return;
  const minHours = Number(policyForm.minHours);
  const maxHours = Number(policyForm.maxHours);
  if ((policyForm.minHours !== '' && (!Number.isFinite(minHours) || minHours < 0))
    || (policyForm.maxHours !== '' && (!Number.isFinite(maxHours) || maxHours < 0))
    || (policyForm.minHours !== '' && policyForm.maxHours !== '' && minHours > maxHours)) {
    policyErrorMessage.value = '销毁窗口无效：需为不小于 0 的小时数，且最短不超过最长。';
    return;
  }
  const minSeconds = policyForm.minHours === '' ? null : Math.round(minHours * 3600);
  const maxSeconds = policyForm.maxHours === '' ? null : Math.round(maxHours * 3600);
  if ((minSeconds !== null && !Number.isFinite(minSeconds)) || (maxSeconds !== null && !Number.isFinite(maxSeconds))) {
    policyErrorMessage.value = '销毁窗口无效：小时数过大，无法转换为秒。';
    return;
  }
  if ((minSeconds !== null && minSeconds > maxDestructionAheadSeconds)
    || (maxSeconds !== null && maxSeconds > maxDestructionAheadSeconds)) {
    policyErrorMessage.value = '销毁窗口无效：最短和最长提前量均不能超过 87600 小时。';
    return;
  }
  const sequence = ++policyWriteSequence;
  const isCurrent = () => active && sequence === policyWriteSequence && identity === identitySequence
    && principalId === kmsState.me?.principalId && canManageDestruction.value;
  policySaving.value = true;
  policyErrorMessage.value = '';
  errorMessage.value = '';
  try {
    await saveMyDestructionPolicy({
      minScheduleAheadSeconds: minSeconds,
      maxScheduleAheadSeconds: maxSeconds
    });
    if (!isCurrent()) return;
    policyOpen.value = false;
    ++policyRevision.value;
  } catch (error) {
    if (!isCurrent()) return;
    policyErrorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    if (isCurrent()) policySaving.value = false;
  }
}

// 撤权需要推进独立序号，恢复权限后旧请求也不能继续操作新表单。
watch(canManageKeys, allowed => {
  if (allowed) return;
  ++createSequence;
  creating.value = false;
  createOpen.value = false;
  createRequestKey.value = '';
  createRequestBody.value = '';
  createErrorMessage.value = '';
  Object.assign(createForm, { keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
}, { flush: 'sync' });
watch(canManageDestruction, allowed => {
  if (allowed) return;
  ++policyReadSequence;
  ++policyWriteSequence;
  policyOpen.value = false;
  policySaving.value = false;
  policyLoading.value = false;
  policyReadFailed.value = false;
  policyErrorMessage.value = '';
  Object.assign(policyForm, { minHours: '', maxHours: '' });
}, { flush: 'sync' });
watch([() => kmsState.me?.principalId, canReadKeys], ([principalId], previous) => {
  if (previous && principalId === previous[0]) {
    ++keysLoadSequence;
    keys.value = [];
    totalElements.value = 0;
    loading.value = false;
    closeDetails();
    errorMessage.value = '';
    message.value = '';
    if (canReadKeys.value) void loadKeys();
    return;
  }
  ++identitySequence;
  ++createSequence;
  ++policyWriteSequence;
  ++keysLoadSequence;
  ++policyReadSequence;
  keys.value = [];
  totalElements.value = 0;
  closeDetails();
  creating.value = false;
  createOpen.value = false;
  createRequestKey.value = '';
  createRequestBody.value = '';
  createErrorMessage.value = '';
  Object.assign(createForm, { keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
  policyOpen.value = false;
  policySaving.value = false;
  policyLoading.value = false;
  policyReadFailed.value = false;
  policyErrorMessage.value = '';
  policyRevision.value = 0;
  Object.assign(policyForm, { minHours: '', maxHours: '' });
  errorMessage.value = '';
  message.value = '';
  Object.assign(filter, { alias: '', state: '' });
  currentPage.value = 1;
  void loadKeys();
}, { flush: 'sync' });
onMounted(() => { void loadKeys(); document.addEventListener('keydown', handleDialogKeydown); });
onBeforeUnmount(() => {
  active = false;
  ++createSequence;
  ++policyWriteSequence;
  ++keysLoadSequence;
  ++policyReadSequence;
  ++identitySequence;
  document.removeEventListener('keydown', handleDialogKeydown);
});
</script>

<template>
  <section class="kms-page">
    <PageHeader
      title="我的密钥"
      description="个人工作区"
    >
      <template #actions>
        <button
          v-if="canManageKeys"
          class="button-primary"
          type="button"
          @click="openCreate"
        >
          新建密钥
        </button>
        <button
          v-if="canManageDestruction"
          class="button-secondary"
          type="button"
          @click="openPolicy"
        >
          销毁政策
        </button>
      </template>
    </PageHeader>
    <p
      v-if="message"
      class="kms-message success"
      role="status"
    >
      {{ message }}
    </p>
    <p
      v-if="errorMessage"
      class="kms-message danger"
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
        />
        重试
      </button>
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
        aria-label="新建密钥"
        tabindex="-1"
      >
        <form
          class="kms-form"
          @submit.prevent="() => void submitCreate()"
        >
          <h2>新建密钥</h2>
          <p
            v-if="createErrorMessage"
            class="kms-message danger"
            role="alert"
          >
            {{ createErrorMessage }}
          </p>
          <label>
            密钥别名
            <input
              v-model.trim="createForm.keyAlias"
              :disabled="creating"
              maxlength="128"
              placeholder="例如：订单签名密钥"
              required
            >
          </label>
          <div class="kms-field">
            <span>用途</span>
            <FormSelect
              v-model="createForm.purpose"
              :disabled="creating"
              aria-label="用途"
              :options="purposeOptions"
            />
          </div>
          <div class="kms-field">
            <span>算法</span>
            <FormSelect
              v-model="createForm.algorithm"
              :disabled="creating"
              aria-label="算法"
              :options="createAlgorithmOptions"
            />
          </div>
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
    <div class="kms-toolbar">
      <input
        v-model="filter.alias"
        aria-label="按别名筛选"
        placeholder="密钥别名"
        @keyup.enter="searchKeys"
      >
      <FormSelect
        v-model="filter.state"
        aria-label="按状态筛选"
        :options="stateOptions"
      />
      <button
        type="button"
        class="button-secondary"
        :disabled="loading || !canReadKeys"
        @click="searchKeys"
      >
        <Search
          :size="16"
          aria-hidden="true"
        />
        查询
      </button>
    </div>
    <section class="admin-data-surface">
      <div class="kms-surface-header">
        <div><h2>归属于我的密钥</h2><span>仅显示当前主体可见的归属</span></div><span>{{ totalElements }} 项</span>
      </div>
      <div
        class="kms-table-wrap"
        :aria-busy="loading"
      >
        <table class="responsive-table">
          <thead><tr><th>别名</th><th>用途</th><th>算法</th><th>状态</th><th>活动版本</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr
              v-for="key in keys"
              :key="key.keyRef"
            >
              <td>{{ key.keyAlias }}</td><td>{{ key.purpose }}</td><td>{{ key.algorithm }}</td><td>
                <span
                  class="status-badge"
                  :class="key.state === 'ACTIVE' ? 'success' : key.state === 'PENDING_DESTRUCTION' ? 'warning' : 'neutral'"
                >{{ key.state }}</span>
              </td><td>{{ key.activeVersion ?? '-' }}</td>
              <td>{{ readableTime(key.createdAt) }}</td>
              <td>
                <button
                  type="button"
                  class="table-action kms-view-detail"
                  title="查看详情"
                  :aria-label="`查看${key.keyAlias}详情`"
                  @click="selectKey(key)"
                >
                  查看详情
                </button>
              </td>
            </tr>
            <tr v-if="loading">
              <td
                colspan="7"
                class="kms-empty"
              >
                正在加载密钥...
              </td>
            </tr>
            <tr v-else-if="keys.length === 0">
              <td
                colspan="7"
                class="kms-empty"
              >
                {{ !canReadKeys ? '当前身份没有读取密钥的权限' : filter.alias || filter.state ? '当前筛选条件下没有匹配的密钥' : canManageKeys ? '暂无密钥，点击右上角「新建密钥」创建第一把' : '暂无密钥' }}
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
    <KeyDetails
      v-if="selectedKeyRef"
      :key-ref="selectedKeyRef"
      :initial-key="selectedKey"
      :policy-revision="policyRevision"
      :close-blocked="policyOpen || createOpen"
      @changed="() => void loadKeys()"
      @edit-policy="openPolicy"
      @close="closeDetails"
    />
    <div
      v-if="policyOpen"
      class="dialog-backdrop"
      @click.self="closePolicy"
    >
      <section
        ref="policyDialog"
        class="confirm-dialog kms-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="销毁窗口政策"
        tabindex="-1"
      >
        <form
          class="kms-form"
          @submit.prevent="() => void submitPolicy()"
        >
          <h2>销毁窗口政策</h2>
          <p class="kms-policy-hint">
            此政策适用于我名下的全部密钥，限制安排销毁允许的提前时间，留空的一侧不限制。
            保存不会自动安排销毁，也不会改变已有任务时间。仅后台从未领取过的任务可以取消。
          </p>
          <p
            v-if="policyErrorMessage"
            class="kms-message danger"
            role="alert"
          >
            {{ policyErrorMessage }}
            <button
              v-if="policyReadFailed"
              class="button-secondary"
              type="button"
              @click="openPolicy"
            >
              <RefreshCw
                :size="15"
                aria-hidden="true"
              />重试
            </button>
          </p>
          <label>最短提前量（小时）<input
            v-model="policyForm.minHours"
            :disabled="policyLoading || policySaving || policyReadFailed"
            type="number"
            min="0"
            :max="maxDestructionAheadSeconds / 3600"
            step="any"
            placeholder="不限制"
            @input="policyErrorMessage = ''"
          ></label>
          <label>最长提前量（小时）<input
            v-model="policyForm.maxHours"
            :disabled="policyLoading || policySaving || policyReadFailed"
            type="number"
            min="0"
            :max="maxDestructionAheadSeconds / 3600"
            step="any"
            placeholder="不限制"
            @input="policyErrorMessage = ''"
          ></label>
          <footer class="kms-form-dialog-actions">
            <button
              type="button"
              class="button-secondary"
              :disabled="policySaving"
              @click="closePolicy"
            >
              取消
            </button>
            <button
              type="submit"
              class="button-primary"
              :disabled="policySaving || policyLoading || policyReadFailed"
            >
              {{ policySaving || policyLoading ? '保存中...' : '保存' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </section>
</template>
