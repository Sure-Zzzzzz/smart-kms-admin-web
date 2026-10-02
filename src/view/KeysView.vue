<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { watch } from 'vue';
import { cancelKmsDestruction, changeKmsKeyState, createKmsKey, getOwnerDestructionPolicy, listAdminKmsKeys, rotateKmsKey, scheduleKmsDestruction, type KmsKey, type KmsOwnerDestructionPolicy } from '../api/kmsApi';

const keys = ref<KmsKey[]>([]);
const selected = ref<KmsKey | null>(null);
const ownerPolicy = ref<KmsOwnerDestructionPolicy | null>(null);

function policyWindowHint(): string {
  if (!ownerPolicy.value || !ownerPolicy.value.exists) return '';
  const min = ownerPolicy.value.minScheduleAheadSeconds;
  const max = ownerPolicy.value.maxScheduleAheadSeconds;
  if (min === null && max === null) return '';
  const fmt = (seconds: number | null) => seconds === null ? null : (seconds % 3600 === 0 ? `${seconds / 3600} 小时` : `${Math.round(seconds / 60)} 分钟`);
  const parts: string[] = [];
  if (min !== null) parts.push(`不早于 ${fmt(min)} 后`);
  if (max !== null) parts.push(`不晚于 ${fmt(max)} 内`);
  return `该归属人的销毁窗口：${parts.join('，')}（越窗将被拒绝）`;
}

watch(selected, (key) => {
  ownerPolicy.value = null;
  if (!key?.ownerPrincipalId) return;
  void getOwnerDestructionPolicy(key.ownerPrincipalId).then((policy) => { ownerPolicy.value = policy; }).catch(() => { });
});
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const filter = reactive({ alias: '', state: '' });
const createForm = reactive({ keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
const destructionDueAt = ref('');
const canSchedule = computed(() => selected.value?.state === 'ACTIVE' || selected.value?.state === 'DISABLED');

function requestKey() { return crypto.randomUUID(); }
function readableTime(value: string | null) { return value ? new Date(value).toLocaleString() : '-'; }

async function loadKeys() {
  errorMessage.value = '';
  loading.value = true;
  try {
    const result = await listAdminKmsKeys({ page: 1, size: 100, alias: filter.alias || undefined, state: filter.state || undefined });
    keys.value = result.items;
    if (selected.value) selected.value = result.items.find(item => item.keyRef === selected.value?.keyRef) || null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '';
  } finally { loading.value = false; }
}

async function submitCreate() {
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    selected.value = await createKmsKey({ ...createForm }, requestKey());
    createForm.keyAlias = '';
    message.value = '密钥已创建。';
    await loadKeys();
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; }
  finally { submitting.value = false; }
}

async function submitState(state: 'ACTIVE' | 'DISABLED') {
  if (!selected.value) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    selected.value = await changeKmsKeyState(selected.value.keyRef, state, selected.value.rowVersion, requestKey());
    message.value = '密钥状态已更新。'; await loadKeys();
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; }
  finally { submitting.value = false; }
}

async function submitRotate() {
  if (!selected.value) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    selected.value = await rotateKmsKey(selected.value.keyRef, selected.value.rowVersion, requestKey());
    message.value = '已创建新的活动版本。'; await loadKeys();
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; }
  finally { submitting.value = false; }
}

async function submitDestruction() {
  if (!selected.value || !destructionDueAt.value) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    selected.value = await scheduleKmsDestruction(selected.value.keyRef, new Date(destructionDueAt.value).toISOString(), selected.value.rowVersion, requestKey());
    message.value = '已安排销毁任务。'; destructionDueAt.value = ''; await loadKeys();
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; }
  finally { submitting.value = false; }
}

async function submitCancelDestruction() {
  if (!selected.value || !window.confirm('取消后，尚未被领取的销毁任务将被删除。是否继续？')) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    await cancelKmsDestruction(selected.value.keyRef, selected.value.rowVersion, requestKey());
    selected.value = null;
    message.value = '已取消销毁任务。'; await loadKeys();
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; }
  finally { submitting.value = false; }
}

onMounted(() => { void loadKeys(); });
</script>

<template>
  <section class="kms-page">
    <header class="kms-page-header">
      <div><span>密钥管理</span><h1>逻辑密钥</h1></div>
    </header>
    <p
      v-if="errorMessage"
      class="kms-message danger"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <p
      v-if="message"
      class="kms-message success"
      role="status"
    >
      {{ message }}
    </p>
    <div class="kms-toolbar">
      <input
        v-model="filter.alias"
        aria-label="按别名筛选"
        placeholder="密钥别名"
        @keyup.enter="() => void loadKeys()"
      >
      <select
        v-model="filter.state"
        aria-label="按状态筛选"
      >
        <option value="">
          全部状态
        </option><option value="ACTIVE">
          活动
        </option><option value="DISABLED">
          已停用
        </option><option value="PENDING_DESTRUCTION">
          待销毁
        </option><option value="DESTROYED">
          已销毁
        </option>
      </select>
      <button
        type="button"
        class="button-secondary"
        :disabled="loading"
        @click="() => void loadKeys()"
      >
        查询
      </button>
    </div>
    <div class="kms-workspace">
      <section class="admin-data-surface">
        <div class="kms-surface-header">
          <h2>密钥列表</h2><span>{{ keys.length }} 项</span>
        </div>
        <div class="kms-table-wrap">
          <table class="responsive-table">
            <thead><tr><th>别名</th><th>用途</th><th>算法</th><th>状态</th><th>活动版本</th></tr></thead>
            <tbody>
              <tr
                v-for="key in keys"
                :key="key.keyRef"
                :class="{ selected: selected?.keyRef === key.keyRef }"
                @click="selected = key"
              >
                <td>{{ key.keyAlias }}</td><td>{{ key.purpose }}</td><td>{{ key.algorithm }}</td><td>
                  <span
                    class="status-badge"
                    :class="key.state === 'ACTIVE' ? 'success' : key.state === 'PENDING_DESTRUCTION' ? 'warning' : 'neutral'"
                  >{{ key.state }}</span>
                </td><td>{{ key.activeVersion ?? '-' }}</td>
              </tr>
              <tr v-if="!loading && keys.length === 0">
                <td
                  colspan="5"
                  class="kms-empty"
                >
                  暂无密钥
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <aside class="kms-detail-panel">
        <h2>创建密钥</h2>
        <form
          class="drawer-form"
          @submit.prevent="() => void submitCreate()"
        >
          <label>别名<input
            v-model.trim="createForm.keyAlias"
            required
            maxlength="128"
          ></label><label>用途<select
            v-model="createForm.purpose"
            @change="createForm.algorithm = createForm.purpose === 'SIGN' ? 'ES256' : 'AES_256_GCM'"
          ><option value="SIGN">签名</option><option value="ENCRYPT">加密</option></select></label><label>算法<input
            :value="createForm.algorithm === 'ES256' ? 'ES256' : 'AES-256-GCM'"
            readonly
          ></label><button
            class="button-primary"
            type="submit"
            :disabled="submitting"
          >
            创建
          </button>
        </form>
      </aside>
    </div>
    <section
      v-if="selected"
      class="admin-data-surface kms-selected-detail"
    >
      <div class="kms-surface-header">
        <div><span>已选密钥</span><h2>{{ selected.keyAlias }}</h2></div><code>{{ selected.keyRef }}</code>
      </div>
      <dl class="kms-facts">
        <div><dt>状态</dt><dd>{{ selected.state }}</dd></div><div><dt>活动版本</dt><dd>{{ selected.activeVersion ?? '-' }}</dd></div><div><dt>最近更新</dt><dd>{{ readableTime(selected.updatedAt) }}</dd></div><div><dt>乐观锁版本</dt><dd>{{ selected.rowVersion }}</dd></div>
      </dl>
      <div
        class="kms-actions"
      >
        <button
          type="button"
          class="button-secondary"
          :disabled="submitting || selected.state !== 'ACTIVE'"
          @click="() => void submitState('DISABLED')"
        >
          停用
        </button><button
          type="button"
          class="button-secondary"
          :disabled="submitting || selected.state !== 'DISABLED'"
          @click="() => void submitState('ACTIVE')"
        >
          启用
        </button><button
          type="button"
          class="button-secondary"
          :disabled="submitting || selected.state !== 'ACTIVE'"
          @click="() => void submitRotate()"
        >
          轮换
        </button>
      </div>
      <div
        class="kms-destruction-action"
      >
        <template v-if="canSchedule">
          <span
            v-if="policyWindowHint()"
            class="kms-policy-hint"
          >{{ policyWindowHint() }}</span>
          <input
            v-model="destructionDueAt"
            type="datetime-local"
            aria-label="销毁时间"
          ><button
            type="button"
            class="button-danger"
            :disabled="submitting || !destructionDueAt"
            @click="() => void submitDestruction()"
          >
            安排销毁
          </button>
        </template><button
          v-else-if="selected.state === 'PENDING_DESTRUCTION'"
          type="button"
          class="button-secondary"
          :disabled="submitting"
          @click="() => void submitCancelDestruction()"
        >
          取消销毁
        </button>
      </div>
    </section>
  </section>
</template>
