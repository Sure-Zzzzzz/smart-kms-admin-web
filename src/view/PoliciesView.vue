<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Plus, ShieldCheck, Trash2 } from 'lucide-vue-next';
import { createKmsPolicy, listAdminKmsKeys, listKmsPolicies, revokeKmsPolicy, type KmsKey, type KmsPolicy } from '../api/kmsApi';

const keys = ref<KmsKey[]>([]); const policies = ref<KmsPolicy[]>([]); const keyRef = ref('');
const loading = ref(false); const submitting = ref(false); const errorMessage = ref(''); const message = ref('');
const form = reactive({ principalId: '', keyVersion: '', operation: 'SIGN', expiresAt: '' });
function requestKey() { return crypto.randomUUID(); }

async function loadKeys() { try { keys.value = (await listAdminKmsKeys({ page: 1, size: 100 })).items; } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; } }
async function loadPolicies() { if (!keyRef.value) { policies.value = []; return; } errorMessage.value = ''; loading.value = true; try { policies.value = (await listKmsPolicies(keyRef.value)).items; } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; } finally { loading.value = false; } }
async function submitCreate() { if (!keyRef.value) return; errorMessage.value = ''; message.value = ''; submitting.value = true; try { await createKmsPolicy(keyRef.value, { principalId: form.principalId, keyVersion: form.keyVersion ? Number(form.keyVersion) : undefined, operation: form.operation, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined }, requestKey()); Object.assign(form, { principalId: '', keyVersion: '', operation: 'SIGN', expiresAt: '' }); message.value = '策略已创建。'; await loadPolicies(); } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; } finally { submitting.value = false; } }
async function submitRevoke(policy: KmsPolicy) { if (!keyRef.value || !window.confirm('撤销后该主体将不能再使用此策略授权。是否继续？')) return; errorMessage.value = ''; message.value = ''; submitting.value = true; try { await revokeKmsPolicy(keyRef.value, policy.policyId, policy.rowVersion, requestKey()); message.value = '策略已撤销。'; await loadPolicies(); } catch (error) { errorMessage.value = error instanceof Error ? error.message : ''; } finally { submitting.value = false; } }
onMounted(() => { void loadKeys(); });
</script>

<template>
  <section class="kms-page">
    <header class="kms-page-header">
      <div><span>精确授权</span><h1>密钥策略</h1></div><ShieldCheck
        :size="26"
        aria-hidden="true"
      />
    </header><p
      v-if="errorMessage"
      class="kms-message danger"
      role="alert"
    >
      {{ errorMessage }}
    </p><p
      v-if="message"
      class="kms-message success"
      role="status"
    >
      {{ message }}
    </p>
    <section class="admin-data-surface">
      <div class="kms-toolbar">
        <select
          v-model="keyRef"
          aria-label="选择密钥"
          @change="() => void loadPolicies()"
        >
          <option value="">
            选择密钥
          </option><option
            v-for="key in keys"
            :key="key.keyRef"
            :value="key.keyRef"
          >
            {{ key.keyAlias }} · {{ key.keyRef }}
          </option>
        </select>
      </div>
      <form
        class="kms-inline-form"
        @submit.prevent="() => void submitCreate()"
      >
        <label>主体标识<input
          v-model.trim="form.principalId"
          required
        ></label><label>版本<input
          v-model="form.keyVersion"
          type="number"
          min="1"
        ></label><label>操作<select v-model="form.operation"><option value="SIGN">签名</option><option value="VERIFY">验签</option><option value="ENCRYPT">加密</option><option value="DECRYPT">解密</option><option value="READ_PUBLIC_KEY">读取公钥</option></select></label><label>到期时间<input
          v-model="form.expiresAt"
          type="datetime-local"
        ></label><button
          class="button-primary"
          type="submit"
          :disabled="submitting || !keyRef"
        >
          <Plus
            :size="16"
            aria-hidden="true"
          />创建策略
        </button>
      </form>
    </section>
    <section class="admin-data-surface">
      <div class="kms-surface-header">
        <h2>策略列表</h2><span>{{ policies.length }} 项</span>
      </div><div class="kms-table-wrap">
        <table class="responsive-table">
          <thead><tr><th>主体</th><th>版本</th><th>操作</th><th>到期时间</th><th /></tr></thead><tbody>
            <tr
              v-for="policy in policies"
              :key="policy.policyId"
            >
              <td><code>{{ policy.principalId }}</code></td><td>{{ policy.keyVersion ?? '全部' }}</td><td>{{ policy.operation }}</td><td>{{ policy.expiresAt ? new Date(policy.expiresAt).toLocaleString() : '长期有效' }}</td><td>
                <button
                  type="button"
                  class="table-action button-danger"
                  :disabled="submitting"
                  aria-label="撤销策略"
                  @click="() => void submitRevoke(policy)"
                >
                  <Trash2
                    :size="16"
                    aria-hidden="true"
                  />
                </button>
              </td>
            </tr><tr v-if="!loading && policies.length === 0">
              <td
                colspan="5"
                class="kms-empty"
              >
                请选择密钥后查看策略
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>
