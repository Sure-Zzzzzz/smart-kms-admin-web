<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { createKmsKey, listMyKmsKeys, loadMyDestructionPolicy, saveMyDestructionPolicy, type KmsKey } from '../api/kmsApi';

const keys = ref<KmsKey[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const filter = reactive({ alias: '', state: '' });

const createOpen = ref(false);
const creating = ref(false);
const createForm = reactive({ keyAlias: '', purpose: 'SIGN', algorithm: 'ES256' });
const createAlgorithmOptions = computed(() =>
  createForm.purpose === 'SIGN' ? ['ES256'] : ['AES_256_GCM']);

function requestKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function openCreate() {
  createForm.keyAlias = '';
  createForm.purpose = 'SIGN';
  createForm.algorithm = 'ES256';
  createOpen.value = true;
}

async function submitCreate() {
  if (!createForm.keyAlias.trim() || creating.value) return;
  creating.value = true;
  errorMessage.value = '';
  try {
    await createKmsKey({ keyAlias: createForm.keyAlias.trim(), purpose: createForm.purpose, algorithm: createForm.algorithm }, requestKey());
    createOpen.value = false;
    await loadKeys();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建失败';
  } finally {
    creating.value = false;
  }
}

async function loadKeys() {
  loading.value = true;
  errorMessage.value = '';
  try {
    keys.value = (await listMyKmsKeys({ page: 1, size: 100, alias: filter.alias || undefined, state: filter.state || undefined })).items;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '查询失败';
  } finally {
    loading.value = false;
  }
}

const policyOpen = ref(false);
const policySaving = ref(false);
const policyForm = reactive({ minHours: '', maxHours: '' });

function openPolicy() {
  policyForm.minHours = '';
  policyForm.maxHours = '';
  policyOpen.value = true;
  void loadMyDestructionPolicy().then((policy) => {
    if (policy.exists) {
      policyForm.minHours = policy.minScheduleAheadSeconds === null ? '' : String(policy.minScheduleAheadSeconds / 3600);
      policyForm.maxHours = policy.maxScheduleAheadSeconds === null ? '' : String(policy.maxScheduleAheadSeconds / 3600);
    }
  }).catch(() => { });
}

async function submitPolicy() {
  if (policySaving.value) return;
  const minHours = Number(policyForm.minHours);
  const maxHours = Number(policyForm.maxHours);
  if ((policyForm.minHours !== '' && (!Number.isFinite(minHours) || minHours < 0))
    || (policyForm.maxHours !== '' && (!Number.isFinite(maxHours) || maxHours < 0))
    || (policyForm.minHours !== '' && policyForm.maxHours !== '' && minHours > maxHours)) {
    errorMessage.value = '销毁窗口无效：需为不小于 0 的小时数，且最短不超过最长。';
    return;
  }
  policySaving.value = true;
  errorMessage.value = '';
  try {
    await saveMyDestructionPolicy({
      minScheduleAheadSeconds: policyForm.minHours === '' ? null : Math.round(minHours * 3600),
      maxScheduleAheadSeconds: policyForm.maxHours === '' ? null : Math.round(maxHours * 3600)
    });
    policyOpen.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    policySaving.value = false;
  }
}

onMounted(() => { void loadKeys(); });
</script>

<template>
  <section class="kms-page">
    <header class="kms-page-header">
      <div><span>个人工作区</span><h1>我的密钥</h1></div>
      <div class="kms-header-actions">
        <button
          class="button-primary"
          type="button"
          @click="openCreate"
        >
          新建密钥
        </button>
        <button
          class="button-secondary"
          type="button"
          @click="openPolicy"
        >
          销毁政策
        </button>
      </div>
    </header>
    <p
      v-if="errorMessage"
      class="kms-message danger"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <div
      v-if="createOpen"
      class="dialog-backdrop"
      @click.self="!creating && (createOpen = false)"
    >
      <section
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新建密钥"
      >
        <form @submit.prevent="() => void submitCreate()">
        <h2>新建密钥</h2>
        <label>
          密钥别名
          <input
            v-model.trim="createForm.keyAlias"
            maxlength="128"
            placeholder="例如：订单签名密钥"
            required
          >
        </label>
        <label>用途
          <select v-model="createForm.purpose">
            <option value="SIGN">
              签名（SIGN）
            </option>
            <option value="ENCRYPT">
              加解密（ENCRYPT）
            </option>
          </select>
        </label>
        <label>算法
          <select v-model="createForm.algorithm">
            <option
              v-for="option in createAlgorithmOptions"
              :key="option"
              :value="option"
            >
              {{ option === 'ES256' ? 'ES256（非对称）' : 'AES-256-GCM（对称）' }}
            </option>
          </select>
        </label>
        <footer class="kms-dialog-actions">
          <button
            type="button"
            class="button-secondary"
            :disabled="creating"
            @click="createOpen = false"
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
        </option>
        <option value="PENDING_DESTRUCTION">
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
    <section class="admin-data-surface">
      <div class="kms-surface-header">
        <h2>归属于我的密钥</h2><span>{{ keys.length }} 项</span>
      </div>
      <div class="kms-table-wrap">
        <table class="responsive-table">
          <thead><tr><th>别名</th><th>用途</th><th>算法</th><th>状态</th><th>活动版本</th></tr></thead>
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
            </tr>
            <tr v-if="!loading && keys.length === 0">
              <td
                colspan="5"
                class="kms-empty"
              >
                暂无密钥，点击右上角「新建密钥」创建第一把
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div
      v-if="policyOpen"
      class="dialog-backdrop"
      @click.self="!policySaving && (policyOpen = false)"
    >
      <section
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="销毁窗口政策"
      >
        <form @submit.prevent="() => void submitPolicy()">
          <h2>销毁窗口政策</h2>
          <p class="kms-policy-hint">
            设定"安排销毁"允许的时间范围，留空表示不限制。窗口内可随时取消销毁；
            这是归属人自己的选择，服务端强制执行。
          </p>
          <label>最短提前量（小时）<input
            v-model="policyForm.minHours"
            type="number"
            min="0"
            step="1"
            placeholder="不限制"
          ></label>
          <label>最长提前量（小时）<input
            v-model="policyForm.maxHours"
            type="number"
            min="0"
            step="1"
            placeholder="不限制"
          ></label>
          <footer class="kms-dialog-actions">
            <button
              type="button"
              class="button-secondary"
              :disabled="policySaving"
              @click="policyOpen = false"
            >取消</button>
            <button
              type="submit"
              class="button-primary"
              :disabled="policySaving"
            >{{ policySaving ? '保存中...' : '保存' }}</button>
          </footer>
        </form>
      </section>
    </div>
  </section>
</template>
