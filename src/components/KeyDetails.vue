<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { principalLabel, principalSourceKind, principalSourceText } from '../support/principal';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import { Copy, RefreshCw } from 'lucide-vue-next';
import {
  cancelKmsDestruction, cancelMyKmsDestruction, changeKmsKeyState, changeMyKmsKeyState,
  getAdminKmsDestruction, getAdminKmsKey, getMyKmsDestruction, getMyKmsKey,
  getOwnerDestructionPolicy, KmsApiError, loadMyDestructionPolicy,
  rotateKmsKey, rotateMyKmsKey, scheduleKmsDestruction, scheduleMyKmsDestruction,
  type KmsKey, type KmsKeyDestructionDetails, type KmsOwnerDestructionPolicy
} from '../api/kmsApi';
import { hasKmsApiPermission, kmsState } from '../kmsState';
import KeyPublicKeys from './KeyPublicKeys.vue';

const props = withDefaults(defineProps<{
  keyRef: string;
  mode?: 'self' | 'governance';
  initialKey?: KmsKey;
  policyRevision?: number;
  policyEditable?: boolean;
  closeBlocked?: boolean;
}>(), { mode: 'self', initialKey: undefined, policyRevision: 0, policyEditable: true, closeBlocked: false });
const emit = defineEmits<{ changed: []; close: []; 'edit-policy': [] }>();
const open = ref(false);
const detail = ref<KmsKey | null>(null);
const destruction = ref<KmsKeyDestructionDetails | null>(null);
const destructionLoading = ref(false);
const destructionErrorMessage = ref('');
const loading = ref(false);
const errorMessage = ref('');
const message = ref('');
const ownerPolicy = ref<KmsOwnerDestructionPolicy | null>(null);
const policyLoading = ref(false);
const policyErrorMessage = ref('');
const destructionDueAt = ref('');
const submitting = ref(false);
const initialAlias = ref(props.initialKey?.keyAlias || '');
let detailSequence = 0;
let policySequence = 0;
let operationSequence = 0;
let recoveryPending = false;
const canRead = computed(() => Boolean(kmsState.me?.principalId) && hasKmsApiPermission('kms.key.read'));
const ownsKey = computed(() => detail.value?.ownerPrincipalId === kmsState.me?.principalId);
const canOperate = computed(() => canRead.value && !!detail.value && (props.mode === 'governance' || ownsKey.value));
const canManageKeys = computed(() => canOperate.value && hasKmsApiPermission('kms.key.manage'));
const canDestroy = computed(() => canOperate.value && hasKmsApiPermission('kms.key.destroy'));
const canSchedule = computed(() => detail.value?.state === 'ACTIVE' || detail.value?.state === 'DISABLED');
const canCancel = computed(() => canDestroy.value && detail.value?.state === 'PENDING_DESTRUCTION'
  && !loading.value && !destructionErrorMessage.value && destruction.value?.cancelEligible === true
  && destruction.value.items.length > 0);
const policyWindow = computed(() => {
  if (!ownerPolicy.value) return '';
  const { minScheduleAheadSeconds: min, maxScheduleAheadSeconds: max } = ownerPolicy.value;
  return `最短提前量：${min === null ? '不限制' : `${min / 3600} 小时`}；最长提前量：${max === null ? '不限制' : `${max / 3600} 小时`}`;
});
type Action = 'disable' | 'enable' | 'rotate' | 'schedule' | 'cancel';
interface Operation {
  action: Action; mode: 'self' | 'governance'; principalId: string;
  target: KmsKey; idempotencyKey: string; dueAt: string; attempted: boolean;
}
const operation = ref<Operation | null>(null);
const drawerPending = computed(() => submitting.value || operation.value !== null || props.closeBlocked);
const operationErrorMessage = ref('');
const drawerTitle = computed(() => detail.value?.keyAlias || (canRead.value ? initialAlias.value : '') || '密钥详情');
const labels: Record<Action, string> = { disable: '停用', enable: '启用', rotate: '轮换', schedule: '安排销毁', cancel: '取消销毁' };
const dialogTitle = computed(() => {
  const action = operation.value?.action;
  return action ? action === 'cancel' ? '取消销毁任务' : action === 'schedule' ? '安排销毁' : `${labels[action]}密钥` : '';
});
const dialogDescription = computed(() => {
  const pending = operation.value;
  if (!pending) return '';
  if (operationErrorMessage.value) return operationErrorMessage.value;
  const name = `「${pending.target.keyAlias}」`;
  if (pending.action === 'schedule') return `${name}将安排于 ${readableTime(pending.dueAt)} 销毁全部版本，销毁完成后不可恢复。是否继续？`;
  if (pending.action === 'cancel') return `取消 ${name} 的销毁任务。仅后台从未领取过的任务可以取消，服务端将最终核验。是否继续？`;
  if (pending.action === 'rotate') return `为 ${name} 创建新的活动版本。已有版本和授权不会自动删除。是否继续？`;
  return `${labels[pending.action]} ${name}。是否继续？`;
});
function readableTime(value: string) { return new Date(value).toLocaleString(); }
function jobStateLabel(state: string) { return ({ PENDING: '等待执行', CLAIMED: '执行中', COMPLETED: '已完成' } as Record<string, string>)[state] || state; }
function clearReads() {
  ++detailSequence;
  ++policySequence;
  detail.value = null;
  destruction.value = null;
  loading.value = false;
  destructionLoading.value = false;
  destructionErrorMessage.value = '';
  ownerPolicy.value = null;
  policyLoading.value = false;
  policyErrorMessage.value = '';
}

async function loadDetails(preserveMessage = false) {
  if (operation.value || submitting.value) { recoveryPending = true; return; }
  recoveryPending = false;
  clearReads();
  const sequence = detailSequence;
  const { keyRef, mode } = props;
  const principalId = kmsState.me?.principalId;
  const isCurrent = () => sequence === detailSequence && keyRef === props.keyRef
    && mode === props.mode && principalId === kmsState.me?.principalId && canRead.value;
  errorMessage.value = '';
  if (!preserveMessage) message.value = '';
  if (!canRead.value || !principalId) return;
  loading.value = true;
  let phase: 'metadata' | 'destruction' = 'metadata';
  try {
    for (let attempt = 0; attempt < 2; ++attempt) {
      phase = 'metadata';
      const result = await (mode === 'self' ? getMyKmsKey(keyRef) : getAdminKmsKey(keyRef));
      if (!isCurrent()) return;
      if (result.keyRef !== keyRef) throw new Error('返回的密钥标识不匹配，请重新读取详情。');
      detail.value = { ...result, ownerPrincipalId: result.ownerPrincipalId ?? (mode === 'self' ? principalId : undefined) };
      phase = 'destruction';
      destructionLoading.value = true;
      const snapshot = await (mode === 'self' ? getMyKmsDestruction(keyRef) : getAdminKmsDestruction(keyRef));
      if (!isCurrent()) return;
      if (snapshot.keyRef === keyRef && snapshot.keyState === result.state && snapshot.rowVersion === result.rowVersion) {
        destruction.value = snapshot;
        return;
      }
      destruction.value = null;
      if (operation.value || submitting.value) { recoveryPending = true; return; }
      // 元数据和任务可能跨越一次状态变化，只自动重读一次，避免持续变化导致循环。
      ++policySequence;
      ownerPolicy.value = null;
      detail.value = null;
      if (attempt === 1) throw new Error('密钥状态与销毁详情已变化，请重新读取详情。');
    }
  } catch (error) {
    if (!isCurrent()) return;
    const text = error instanceof Error ? error.message : '读取密钥详情失败';
    if (phase === 'metadata' || !detail.value) errorMessage.value = text;
    else destructionErrorMessage.value = text;
    destruction.value = null;
  } finally {
    if (isCurrent()) { loading.value = false; destructionLoading.value = false; }
  }
}
async function loadOwnerPolicy() {
  const sequence = ++policySequence;
  const principalId = kmsState.me?.principalId;
  const mode = props.mode;
  const keyRef = props.keyRef;
  ownerPolicy.value = null;
  policyErrorMessage.value = '';
  policyLoading.value = false;
  const owner = detail.value?.ownerPrincipalId;
  if (!canDestroy.value || !owner) return;
  const isCurrent = () => sequence === policySequence && principalId === kmsState.me?.principalId
    && keyRef === props.keyRef && mode === props.mode && canDestroy.value;
  policyLoading.value = true;
  try {
    const policy = await (mode === 'self' ? loadMyDestructionPolicy() : getOwnerDestructionPolicy(owner));
    if (isCurrent()) ownerPolicy.value = policy;
  } catch (error) {
    if (isCurrent()) policyErrorMessage.value = error instanceof Error ? error.message : '读取归属人销毁政策失败';
  } finally {
    if (isCurrent()) policyLoading.value = false;
  }
}
function hasActionPermission(action: Action) {
  return canRead.value && hasKmsApiPermission(action === 'schedule' || action === 'cancel' ? 'kms.key.destroy' : 'kms.key.manage');
}
function allowed(action: Action) {
  if (!detail.value || loading.value) return false;
  if (action === 'schedule') return canDestroy.value && canSchedule.value && !!ownerPolicy.value && !policyLoading.value;
  if (action === 'cancel') return canCancel.value;
  return canManageKeys.value && detail.value.state === (action === 'enable' ? 'DISABLED' : 'ACTIVE');
}
function requestOperation(action: Action) {
  const principalId = kmsState.me?.principalId;
  if (submitting.value || !allowed(action) || !detail.value || !principalId) return;
  let dueAt = '';
  errorMessage.value = '';
  message.value = '';
  if (action === 'schedule') {
    const due = new Date(destructionDueAt.value).getTime();
    const secondsAhead = (due - Date.now()) / 1000;
    const policy = ownerPolicy.value!;
    if (!Number.isFinite(due) || secondsAhead <= 0
      || (policy.minScheduleAheadSeconds !== null && secondsAhead < policy.minScheduleAheadSeconds)
      || (policy.maxScheduleAheadSeconds !== null && secondsAhead > policy.maxScheduleAheadSeconds)) {
      errorMessage.value = '销毁时间需在未来，并符合该归属人的销毁窗口。';
      return;
    }
    dueAt = new Date(due).toISOString();
  }
  operationErrorMessage.value = '';
  operation.value = { action, mode: props.mode, principalId, target: { ...detail.value }, idempotencyKey: crypto.randomUUID(), dueAt, attempted: false };
}
function closeOperation() {
  if (submitting.value) return;
  operation.value = null;
  operationErrorMessage.value = '';
  if (recoveryPending) void loadDetails(true);
}
function closeDetails() {
  if (drawerPending.value) return;
  ++operationSequence;
  clearReads();
  emit('close');
}
async function submitOperation() {
  const pending = operation.value;
  if (!pending || pending.mode !== props.mode || pending.principalId !== kmsState.me?.principalId
    || pending.target.keyRef !== props.keyRef || submitting.value || !hasActionPermission(pending.action)
    || (!pending.attempted && !allowed(pending.action))) return;
  const submitSequence = ++operationSequence;
  const isCurrent = () => submitSequence === operationSequence && pending.principalId === kmsState.me?.principalId
    && pending.mode === props.mode && pending.target.keyRef === props.keyRef && hasActionPermission(pending.action);
  submitting.value = true;
  operationErrorMessage.value = '';
  pending.attempted = true;
  try {
    const { target, idempotencyKey, action, dueAt } = pending;
    // 固定本人或治理入口；未知结果重试沿用原正文、版本和幂等键，不按迟到状态阻断重放。
    const changeState = pending.mode === 'self' ? changeMyKmsKeyState : changeKmsKeyState;
    const rotate = pending.mode === 'self' ? rotateMyKmsKey : rotateKmsKey;
    const schedule = pending.mode === 'self' ? scheduleMyKmsDestruction : scheduleKmsDestruction;
    const cancel = pending.mode === 'self' ? cancelMyKmsDestruction : cancelKmsDestruction;
    if (action === 'disable' || action === 'enable') await changeState(target.keyRef, action === 'enable' ? 'ACTIVE' : 'DISABLED', target.rowVersion, idempotencyKey);
    else if (action === 'rotate') await rotate(target.keyRef, target.rowVersion, idempotencyKey);
    else if (action === 'schedule') await schedule(target.keyRef, dueAt, target.rowVersion, idempotencyKey);
    else await cancel(target.keyRef, target.rowVersion, idempotencyKey);
    if (!isCurrent()) return;
    operation.value = null;
    submitting.value = false;
    destructionDueAt.value = '';
    message.value = `${labels[action]}成功。`;
    emit('changed');
    await loadDetails(true);
  } catch (error) {
    if (!isCurrent()) return;
    const text = error instanceof Error ? error.message : '密钥操作失败，请重试';
    if (error instanceof KmsApiError && error.status === 409) {
      operation.value = null;
      submitting.value = false;
      await loadDetails(true);
      if (isCurrent()) errorMessage.value = `${text}。请核对重新读取的详情后重新确认操作。${errorMessage.value}`;
    } else operationErrorMessage.value = text;
  } finally {
    if (submitSequence === operationSequence) {
      submitting.value = false;
      if (recoveryPending && !operation.value) void loadDetails(true);
    }
  }
}
async function copyOwnerPrincipalId() {
  if (!canRead.value || !detail.value?.ownerPrincipalId) return;
  const sequence = detailSequence;
  errorMessage.value = '';
  message.value = '';
  try {
    await navigator.clipboard.writeText(detail.value.ownerPrincipalId);
    if (sequence === detailSequence && canRead.value) message.value = '归属主体标识已复制，可在治理列表按归属筛选粘贴使用。';
  } catch {
    if (sequence === detailSequence && canRead.value) errorMessage.value = '复制失败，请选中归属主体标识复制';
  }
}

async function copyKeyRef() {
  if (!canRead.value || !detail.value) return;
  const sequence = detailSequence;
  errorMessage.value = '';
  message.value = '';
  try {
    await navigator.clipboard.writeText(props.keyRef);
    if (sequence === detailSequence && canRead.value) message.value = '密钥标识已复制。';
  } catch {
    if (sequence === detailSequence && canRead.value) errorMessage.value = '复制失败，请选中密钥标识复制';
  }
}
watch([() => props.keyRef, () => props.mode, () => kmsState.me?.principalId,
  () => kmsState.me?.subjectType, canRead], (_next, previous) => {
  ++operationSequence;
  operation.value = null;
  submitting.value = false;
  operationErrorMessage.value = '';
  message.value = '';
  destructionDueAt.value = '';
  if (previous?.length) initialAlias.value = '';
  void loadDetails();
}, { immediate: true, flush: 'sync' });
watch([() => hasKmsApiPermission('kms.key.manage'), () => hasKmsApiPermission('kms.key.destroy')], () => {
  if (!hasKmsApiPermission('kms.key.destroy')) destructionDueAt.value = '';
  if (operation.value && !hasActionPermission(operation.value.action)) {
    ++operationSequence;
    operation.value = null;
    submitting.value = false;
    operationErrorMessage.value = '';
    if (recoveryPending) void loadDetails(true);
  }
}, { flush: 'sync' });
watch([() => detail.value?.ownerPrincipalId, canDestroy, () => props.policyRevision], () => { void loadOwnerPolicy(); }, { flush: 'sync' });
onMounted(() => { open.value = true; });
onBeforeUnmount(() => { ++detailSequence; ++policySequence; ++operationSequence; });
</script>

<template>
  <Drawer
    class="kms-key-detail-drawer"
    :open="open"
    :title="drawerTitle"
    description="密钥详情"
    :pending="drawerPending"
    @close="closeDetails"
  >
    <section
      class="kms-selected-detail"
      aria-label="密钥详情"
      :aria-busy="loading"
    >
      <p
        v-if="!canRead"
        class="kms-policy-hint"
      >
        当前身份没有读取密钥详情的权限。
      </p>
      <p
        v-if="loading"
        class="kms-policy-hint"
      >
        正在读取密钥详情...
      </p>
      <p
        v-if="errorMessage"
        class="kms-message danger"
        role="alert"
      >
        <span>{{ errorMessage }}</span>
        <button
          v-if="!detail"
          type="button"
          class="button-secondary"
          :disabled="loading || drawerPending || !canRead"
          @click="() => void loadDetails(true)"
        >
          <RefreshCw
            :size="15"
            aria-hidden="true"
          />重新读取详情
        </button>
      </p>
      <p
        v-if="message"
        class="kms-message success"
        role="status"
      >
        {{ message }}
      </p>
      <template v-if="detail">
        <dl class="kms-facts">
          <div>
            <dt>密钥标识</dt><dd class="kms-field-value">
              {{ detail.keyRef }}<button
                type="button"
                class="table-action"
                title="复制密钥标识"
                aria-label="复制密钥标识"
                @click="() => void copyKeyRef()"
              >
                <Copy
                  :size="15"
                  aria-hidden="true"
                />
              </button>
            </dd>
          </div>
          <div>
            <dt>归属主体</dt><dd>
              <span
                v-if="principalSourceKind(detail.ownerPrincipalId)"
                class="status-badge neutral kms-owner-source"
                :title="detail.ownerPrincipalId"
              >{{ principalSourceText(principalSourceKind(detail.ownerPrincipalId)) }}</span> {{ detail.ownerPrincipalId ? principalLabel(detail.ownerPrincipalId, detail.ownerDisplayName) : '无法确定归属' }}<button
                v-if="detail.ownerPrincipalId"
                type="button"
                class="table-action"
                title="复制归属主体标识"
                aria-label="复制归属主体标识"
                @click="() => void copyOwnerPrincipalId()"
              >
                <Copy
                  :size="15"
                  aria-hidden="true"
                />
              </button>
            </dd>
          </div>
          <div><dt>用途</dt><dd>{{ detail.purpose === 'SIGN' ? '签名（SIGN）' : '加解密（ENCRYPT）' }}</dd></div>
          <div><dt>算法</dt><dd>{{ detail.algorithm }}</dd></div>
          <div>
            <dt>状态</dt><dd>
              <span
                class="status-badge"
                :class="detail.state === 'ACTIVE' ? 'success' : detail.state === 'PENDING_DESTRUCTION' ? 'warning' : 'neutral'"
              >{{ detail.state }}</span>
            </dd>
          </div>
          <div><dt>活动版本</dt><dd>{{ detail.activeVersion ?? '-' }}</dd></div>
          <div><dt>创建时间</dt><dd>{{ readableTime(detail.createdAt) }}</dd></div>
          <div><dt>最近更新</dt><dd>{{ readableTime(detail.updatedAt) }}</dd></div>
        </dl>
        <div
          v-if="canManageKeys"
          class="kms-actions kms-key-lifecycle"
        >
          <button
            type="button"
            class="button-secondary"
            :disabled="submitting || loading || detail.state !== 'ACTIVE'"
            @click="requestOperation('disable')"
          >
            停用
          </button>
          <button
            type="button"
            class="button-secondary"
            :disabled="submitting || loading || detail.state !== 'DISABLED'"
            @click="requestOperation('enable')"
          >
            启用
          </button>
          <button
            type="button"
            class="button-secondary"
            :disabled="submitting || loading || detail.state !== 'ACTIVE'"
            @click="requestOperation('rotate')"
          >
            轮换
          </button>
        </div>
        <section
          class="kms-key-policy"
          aria-label="销毁进度"
          :aria-busy="destructionLoading"
        >
          <div class="kms-surface-header">
            <h3>销毁进度</h3>
            <button
              v-if="detail.state === 'PENDING_DESTRUCTION' && destruction"
              type="button"
              class="button-secondary"
              :disabled="loading || drawerPending"
              @click="() => void loadDetails(true)"
            >
              <RefreshCw
                :size="15"
                aria-hidden="true"
              />刷新销毁进度
            </button>
          </div>
          <p
            v-if="destructionLoading"
            class="kms-policy-hint"
          >
            正在读取销毁进度...
          </p>
          <p
            v-else-if="destructionErrorMessage"
            class="kms-message danger"
            role="alert"
          >
            <span>{{ destructionErrorMessage }}</span>
            <button
              type="button"
              class="button-secondary"
              :disabled="loading || drawerPending"
              @click="() => void loadDetails(true)"
            >
              <RefreshCw
                :size="15"
                aria-hidden="true"
              />重新读取销毁详情
            </button>
          </p>
          <template v-else-if="destruction">
            <p
              v-if="destruction.items.length === 0"
              class="kms-policy-hint"
            >
              暂无销毁任务。
            </p>
            <div
              v-else
              class="kms-table-wrap"
            >
              <table class="responsive-table">
                <thead><tr><th>版本</th><th>任务状态</th><th>销毁时间</th><th>完成时间</th></tr></thead>
                <tbody>
                  <tr
                    v-for="job in destruction.items"
                    :key="job.keyVersion"
                  >
                    <td>{{ job.keyVersion }}</td><td>{{ jobStateLabel(job.state) }}</td>
                    <td>{{ readableTime(job.dueAt) }}</td><td>{{ job.completedAt ? readableTime(job.completedAt) : '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              v-if="detail.state === 'PENDING_DESTRUCTION' && !destruction.cancelEligible"
              class="kms-policy-hint"
            >
              当前销毁任务已不能取消；任务一旦被后台领取过就不能取消。
            </p>
            <div
              v-if="canCancel"
              class="kms-destruction-action"
            >
              <p class="kms-policy-hint">
                仅后台从未领取过的销毁任务可以取消；销毁完成后不可恢复。
              </p>
              <button
                type="button"
                class="button-secondary"
                :disabled="submitting"
                @click="requestOperation('cancel')"
              >
                取消销毁
              </button>
            </div>
          </template>
        </section>
        <section
          v-if="canDestroy"
          class="kms-key-policy"
          aria-label="归属人销毁政策"
        >
          <div class="kms-surface-header">
            <h3>归属人销毁政策</h3>
            <button
              v-if="policyEditable && mode === 'self' && ownsKey"
              type="button"
              class="button-secondary"
              :disabled="submitting || loading"
              @click="emit('edit-policy')"
            >
              修改销毁政策
            </button>
          </div>
          <p class="kms-policy-hint">
            此政策适用于当前密钥及归属主体 {{ principalLabel(detail.ownerPrincipalId, detail.ownerDisplayName) }} 名下的全部密钥。保存政策不会自动安排销毁，也不会改变已有任务时间。
          </p>
          <p
            v-if="policyLoading"
            class="kms-policy-hint"
          >
            正在读取销毁政策...
          </p>
          <p
            v-else-if="policyErrorMessage"
            class="kms-message danger"
            role="alert"
          >
            <span>{{ policyErrorMessage }}</span><button
              type="button"
              class="button-secondary"
              @click="() => void loadOwnerPolicy()"
            >
              <RefreshCw
                :size="15"
                aria-hidden="true"
              />重试政策
            </button>
          </p>
          <p
            v-else-if="ownerPolicy"
            class="kms-policy-hint kms-key-policy-window"
          >
            {{ policyWindow }}
          </p>
          <div
            v-if="canSchedule"
            class="kms-destruction-action"
          >
            <label class="kms-field">销毁时间<input
              v-model="destructionDueAt"
              type="datetime-local"
              aria-label="销毁时间"
              :disabled="submitting || loading || policyLoading || !ownerPolicy"
            ></label>
            <button
              type="button"
              class="button-danger"
              :disabled="submitting || loading || !destructionDueAt || policyLoading || !ownerPolicy"
              @click="requestOperation('schedule')"
            >
              安排销毁
            </button>
          </div>
        </section>
        <KeyPublicKeys :key-info="detail" />
      </template>
      <Dialog
        :open="operation !== null"
        :title="dialogTitle"
        :description="dialogDescription"
        :confirm-label="operation ? labels[operation.action] : ''"
        :pending="submitting"
        @close="closeOperation"
        @confirm="() => void submitOperation()"
      />
    </section>
  </Drawer>
</template>
