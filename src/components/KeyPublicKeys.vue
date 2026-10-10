<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import { Copy, RefreshCw } from 'lucide-vue-next';
import { KmsApiError, listMyKmsPublicKeys, type KmsKey, type KmsPublicKey } from '../api/kmsApi';
import { hasKmsApiPermission, kmsState } from '../kmsState';

const props = defineProps<{ keyInfo: KmsKey; refreshRevision?: number }>();
const publicKeys = ref<KmsPublicKey[]>([]);
const selectedVersion = ref('');
const loading = ref(false);
const errorMessage = ref('');
const copying = ref(false);
const copyMessage = ref('');
const copyErrorMessage = ref('');
let loadSequence = 0;
let copySequence = 0;

const isSigningKey = computed(() => props.keyInfo.algorithm === 'ES256' && props.keyInfo.purpose === 'SIGN');
const isHuman = computed(() => kmsState.me?.subjectType === 'HUMAN');
const isOwnedKey = computed(() => Boolean(kmsState.me?.principalId)
  && props.keyInfo.ownerPrincipalId === kmsState.me?.principalId);
const canReadPublicKey = computed(() => hasKmsApiPermission('kms.read-public-key'));
const isPublishable = computed(() => props.keyInfo.state === 'ACTIVE' || props.keyInfo.state === 'DISABLED');
const canLoad = computed(() => isSigningKey.value && isHuman.value && isOwnedKey.value && canReadPublicKey.value && isPublishable.value);
const versionOptions = computed(() => publicKeys.value.map((key) => ({
  value: String(key.version),
  label: `版本 ${key.version} · ${versionStateLabel(key.state)}`
})));
const selectedPublicKey = computed(() => publicKeys.value.find((key) => String(key.version) === selectedVersion.value));

function versionStateLabel(state: string) {
  return state === 'ACTIVE' ? '活动' : state === 'RETIRED' ? '已退役' : state;
}

function clearCopyState() {
  ++copySequence;
  copying.value = false;
  copyMessage.value = '';
  copyErrorMessage.value = '';
}

async function loadPublicKeys() {
  const sequence = ++loadSequence;
  publicKeys.value = [];
  selectedVersion.value = '';
  errorMessage.value = '';
  clearCopyState();
  loading.value = false;
  if (!canLoad.value) return;
  loading.value = true;
  try {
    const keys = await listMyKmsPublicKeys(props.keyInfo.keyRef);
    if (sequence !== loadSequence) return;
    publicKeys.value = [...keys].sort((left, right) => right.version - left.version);
    const initialKey = publicKeys.value.find((key) => key.version === props.keyInfo.activeVersion) ?? publicKeys.value[0];
    selectedVersion.value = initialKey ? String(initialKey.version) : '';
  } catch (error) {
    if (sequence === loadSequence) {
      errorMessage.value = error instanceof KmsApiError && error.status === 403
        ? '公钥读取被拒绝，请确认当前账号仍有读取本人公钥的权限。'
        : error instanceof Error ? error.message : '读取公钥失败';
    }
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function copyPublicKey() {
  if (!selectedPublicKey.value || copying.value) return;
  const value = selectedPublicKey.value.publicKey;
  const sequence = ++copySequence;
  copying.value = true;
  copyMessage.value = '';
  copyErrorMessage.value = '';
  try {
    if (!navigator.clipboard?.writeText) throw new Error();
    await navigator.clipboard.writeText(value);
    if (sequence === copySequence) copyMessage.value = '公钥已复制';
  } catch {
    if (sequence === copySequence) copyErrorMessage.value = '复制公钥失败，请选中公钥值复制。';
  } finally {
    if (sequence === copySequence) copying.value = false;
  }
}

watch(selectedVersion, clearCopyState);
watch([() => props.keyInfo.keyRef, () => props.keyInfo.rowVersion, () => props.keyInfo.activeVersion,
  () => props.keyInfo.state, () => props.keyInfo.purpose, () => props.keyInfo.algorithm,
  () => props.keyInfo.ownerPrincipalId, () => props.refreshRevision, () => kmsState.me?.principalId,
  () => kmsState.me?.subjectType, canReadPublicKey], () => { void loadPublicKeys(); }, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => { ++loadSequence; ++copySequence; });
</script>

<template>
  <section
    class="kms-public-key-section"
    aria-label="公钥"
    :aria-busy="loading"
  >
    <h3>公钥</h3>
    <p
      v-if="!isSigningKey"
      class="kms-policy-hint"
    >
      {{ keyInfo.algorithm === 'AES_256_GCM' ? 'AES-256-GCM 是对称密钥，没有公钥。密钥材料不提供查看或导出。' : '当前密钥不支持查看签名公钥。' }}
    </p>
    <p
      v-else-if="!isHuman"
      class="kms-policy-hint"
    >
      本人公钥查看仅供人员身份使用。
    </p>
    <p
      v-else-if="!isOwnedKey"
      class="kms-policy-hint"
    >
      当前身份只能读取自身归属密钥的公钥。
    </p>
    <p
      v-else-if="!canReadPublicKey"
      class="kms-policy-hint"
    >
      当前身份没有读取公钥的权限，请联系管理员分配读取公钥权限。
    </p>
    <p
      v-else-if="!isPublishable"
      class="kms-policy-hint"
    >
      待销毁或已销毁的密钥不再提供公钥。
    </p>
    <div
      v-else-if="errorMessage"
      class="admin-message error kms-public-key-error"
      role="alert"
    >
      <span>{{ errorMessage }}</span>
      <div class="kms-actions">
        <button
          type="button"
          class="button-secondary"
          :disabled="loading"
          @click="() => void loadPublicKeys()"
        >
          <RefreshCw
            :size="15"
            aria-hidden="true"
          />
          重试
        </button>
      </div>
    </div>
    <p
      v-else-if="loading"
      class="kms-policy-hint"
    >
      正在读取公钥...
    </p>
    <p
      v-else-if="publicKeys.length === 0"
      class="kms-policy-hint"
    >
      暂无可分发的公钥版本。
    </p>
    <template v-else>
      <div class="kms-public-key-header">
        <FormSelect
          v-model="selectedVersion"
          aria-label="公钥版本"
          :options="versionOptions"
        />
        <button
          type="button"
          class="table-action"
          title="复制公钥"
          aria-label="复制公钥"
          :disabled="copying || !selectedPublicKey"
          @click="() => void copyPublicKey()"
        >
          <Copy
            :size="16"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        v-if="selectedPublicKey"
        class="kms-field"
      >
        <span class="kms-policy-hint">X.509 DER（Base64url，无填充）</span>
        <textarea
          class="kms-public-key-material"
          aria-label="公钥值"
          :value="selectedPublicKey.publicKey"
          readonly
          rows="5"
          spellcheck="false"
        />
      </div>
      <p
        v-if="copyErrorMessage"
        class="admin-message error"
        role="alert"
      >
        {{ copyErrorMessage }}
      </p>
      <p
        v-if="copyMessage"
        class="kms-policy-hint"
        role="status"
      >
        {{ copyMessage }}
      </p>
    </template>
  </section>
</template>
