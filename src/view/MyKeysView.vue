<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { KeyRound, Plus, RefreshCw } from 'lucide-vue-next';
import { createKmsKey, listMyKmsKeys, type KmsKey } from '../api/kmsApi';

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

onMounted(() => { void loadKeys(); });
</script>

<template>
  <section class="kms-page">
    <header class="kms-page-header">
      <div><span>个人工作区</span><h1>我的密钥</h1></div>
      <div class="kms-header-actions">
        <button
          type="button"
          @click="openCreate"
        >
          <Plus
            :size="16"
            aria-hidden="true"
          />新建密钥
        </button>
        <KeyRound
          :size="26"
          aria-hidden="true"
        />
      </div>
    </header>
    <p
      v-if="errorMessage"
      class="kms-message danger"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <dialog
      v-if="createOpen"
      class="kms-dialog"
      open
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
        <div class="kms-dialog-actions">
          <button
            type="button"
            class="secondary"
            :disabled="creating"
            @click="createOpen = false"
          >
            取消
          </button>
          <button
            type="submit"
            :disabled="creating || !createForm.keyAlias"
          >
            {{ creating ? '创建中...' : '创建' }}
          </button>
        </div>
      </form>
    </dialog>
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
        class="secondary"
        :disabled="loading"
        @click="() => void loadKeys()"
      >
        <RefreshCw
          :size="16"
          aria-hidden="true"
        />查询
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
  </section>
</template>
