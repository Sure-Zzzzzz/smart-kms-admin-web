import { clearKmsAccessToken, getKmsAccessToken } from '../auth/pkce';
import { kmsState, setKmsMe, type KmsMe } from '../kmsState';

export class KmsApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'KmsApiError'; }
}

export interface KmsPage<T> { items: T[]; page: number; size: number; total: number; }
export interface KmsKey { ownerPrincipalId?: string; ownerDisplayName?: string | null; keyRef: string; keyAlias: string; purpose: 'SIGN' | 'ENCRYPT'; algorithm: 'ES256' | 'AES_256_GCM'; state: 'ACTIVE' | 'DISABLED' | 'PENDING_DESTRUCTION' | 'DESTROYED'; activeVersion: number | null; rowVersion: number; createdAt: string; updatedAt: string; }
export interface KmsPolicy { policyId: string; keyRef: string; principalId: string; principalDisplayName?: string | null; keyVersion: number | null; operation: string; expiresAt: string | null; rowVersion: number; }
export interface KmsPublicKey { keyRef: string; version: number; algorithm: 'ES256'; state: string; publicKey: string; }
export interface KmsKeyDestructionDetails {
  keyRef: string;
  keyState: KmsKey['state'];
  rowVersion: number;
  cancelEligible: boolean;
  items: { keyVersion: number; state: 'PENDING' | 'CLAIMED' | 'COMPLETED'; dueAt: string; completedAt: string | null }[];
}
export interface KmsAdminPolicy { policyId: string; keyRef: string; keyAlias: string; ownerPrincipalId?: string; ownerDisplayName?: string | null; principalId: string; principalDisplayName?: string | null; keyVersion: number | null; operation: string; expiresAt: string | null; rowVersion: number; createdAt: string; }
export interface KmsDestructionJob { ownerPrincipalId?: string; ownerDisplayName?: string | null; keyRef: string; keyVersion: number; state: 'PENDING' | 'CLAIMED' | 'COMPLETED'; dueAt: string; claimUntil: string | null; attemptCount: number; completedAt: string | null; }
export interface KmsWorkerHealth { running: boolean; instanceId: string | null; claimable: boolean; lastSuccessfulScanAt: string | null; consecutiveFailureCount: number; oldestOverdueDelayMillis: number | null; }

function base() { return kmsState.apiBase || '/api/kms'; }
function message(status: number) { return ({ 400: '请求参数无效', 401: '登录状态失效', 403: '没有执行该操作的权限', 404: '资源不存在或已被删除', 409: '资源已被并发修改' } as Record<number, string>)[status] || `请求失败（HTTP ${status}）`; }

async function request<T>(path: string, init: RequestInit = {}, action = '请求'): Promise<T> {
  const token = getKmsAccessToken();
  const response = await window.fetch(`${base()}${path}`, {
    ...init, credentials: 'omit', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  if (response.status === 204) return undefined as T;
  if (response.ok) {
    const body = await response.text();
    return body ? JSON.parse(body) as T : undefined as T;
  }
  // 当前凭据失效时同步撤掉权限；旧请求不能清除等待期间重新授权得到的新身份。
  if (response.status === 401) {
    const currentToken = getKmsAccessToken();
    if (currentToken === null || currentToken === token) {
      clearKmsAccessToken();
      setKmsMe(null);
    }
  }
  throw new KmsApiError(response.status, `${action}失败：${message(response.status)}`);
}

export const loadKmsMe = (signal?: AbortSignal) => request<KmsMe>('/me', signal ? { signal } : {}, '读取当前权限');
export const listKmsKeys = (query: Record<string, string | number | undefined> = {}) => request<KmsPage<KmsKey>>(`/keys?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '').map(([key, value]) => [key, String(value)])).toString()}`, {}, '查询密钥');
export const listAdminKmsPolicies = (query: Record<string, string | number | undefined> = {}) => request<KmsPage<KmsAdminPolicy>>(`/admin/policies?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '').map(([key, value]) => [key, String(value)])).toString()}`, {}, '查询跨钥策略');
export const listAdminKmsKeys = (query: Record<string, string | number | undefined> = {}) => request<KmsPage<KmsKey>>(`/admin/keys?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '').map(([key, value]) => [key, String(value)])).toString()}`, {}, '查询管理范围内密钥');
export const listMyKmsKeys = (query: Record<string, string | number | undefined> = {}) => request<KmsPage<KmsKey>>(`/me/keys?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '').map(([key, value]) => [key, String(value)])).toString()}`, {}, '查询我的密钥');
export const getMyKmsKey = (keyRef: string) => request<KmsKey>(`/me/keys/${encodeURIComponent(keyRef)}`, {}, '读取我的密钥');
export const getAdminKmsKey = (keyRef: string) => request<KmsKey>(`/admin/keys/${encodeURIComponent(keyRef)}`, {}, '读取管理范围内密钥');
export const getKmsKey = (keyRef: string) => request<KmsKey>(`/keys/${encodeURIComponent(keyRef)}`, {}, '读取密钥');
export const listMyKmsPublicKeys = (keyRef: string) => request<KmsPublicKey[]>(`/me/keys/${encodeURIComponent(keyRef)}/public-keys`, {}, '读取我的公钥版本');
export const getMyKmsDestruction = (keyRef: string) => request<KmsKeyDestructionDetails>(`/me/keys/${encodeURIComponent(keyRef)}/destruction`, {}, '读取我的销毁详情');
export const getAdminKmsDestruction = (keyRef: string) => request<KmsKeyDestructionDetails>(`/admin/keys/${encodeURIComponent(keyRef)}/destruction`, {}, '读取管理范围内销毁详情');
export const createKmsKey = (input: { keyAlias: string; purpose: string; algorithm: string }, key: string) => request<KmsKey>('/keys', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }, '创建密钥');
export const changeKmsKeyState = (keyRef: string, state: string, expectedRowVersion: number, key: string) => request<KmsKey>(`/keys/${encodeURIComponent(keyRef)}/state`, { method: 'PATCH', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ state, expectedRowVersion }) }, '修改密钥状态');
export const rotateKmsKey = (keyRef: string, expectedRowVersion: number, key: string) => request<KmsKey>(`/keys/${encodeURIComponent(keyRef)}/versions`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ expectedRowVersion }) }, '轮换密钥');
export const scheduleKmsDestruction = (keyRef: string, dueAt: string, expectedRowVersion: number, key: string) => request<KmsKey>(`/keys/${encodeURIComponent(keyRef)}/destruction`, { method: 'PUT', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ dueAt, expectedRowVersion }) }, '安排销毁');
export const cancelKmsDestruction = (keyRef: string, expectedRowVersion: number, key: string) => request<void>(`/keys/${encodeURIComponent(keyRef)}/destruction`, { method: 'DELETE', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ expectedRowVersion }) }, '取消销毁');
export const changeMyKmsKeyState = (keyRef: string, state: string, expectedRowVersion: number, key: string) => request<KmsKey>(`/me/keys/${encodeURIComponent(keyRef)}/state`, { method: 'PATCH', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ state, expectedRowVersion }) }, '修改我的密钥状态');
export const rotateMyKmsKey = (keyRef: string, expectedRowVersion: number, key: string) => request<KmsKey>(`/me/keys/${encodeURIComponent(keyRef)}/versions`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ expectedRowVersion }) }, '轮换我的密钥');
export const scheduleMyKmsDestruction = (keyRef: string, dueAt: string, expectedRowVersion: number, key: string) => request<KmsKey>(`/me/keys/${encodeURIComponent(keyRef)}/destruction`, { method: 'PUT', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ dueAt, expectedRowVersion }) }, '安排我的密钥销毁');
export const cancelMyKmsDestruction = (keyRef: string, expectedRowVersion: number, key: string) => request<void>(`/me/keys/${encodeURIComponent(keyRef)}/destruction`, { method: 'DELETE', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ expectedRowVersion }) }, '取消我的密钥销毁');
export const listKmsPolicies = (keyRef: string) => request<{ items: KmsPolicy[] }>(`/keys/${encodeURIComponent(keyRef)}/policies`, {}, '查询策略');
export const createKmsPolicy = (keyRef: string, input: { principalId: string; keyVersion?: number; operation: string; expiresAt?: string }, key: string) => request<KmsPolicy>(`/keys/${encodeURIComponent(keyRef)}/policies`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }, '创建策略');
export const revokeKmsPolicy = (keyRef: string, policyId: string, expectedRowVersion: number, key: string) => request<void>(`/keys/${encodeURIComponent(keyRef)}/policies/${encodeURIComponent(policyId)}`, { method: 'DELETE', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ expectedRowVersion }) }, '撤销策略');
export const listKmsDestructionJobs = (page = 1, size = 20, ownerPrincipalId?: string) => request<KmsPage<KmsDestructionJob>>(`/destruction-jobs?page=${page}&size=${size}${ownerPrincipalId ? `&ownerPrincipalId=${encodeURIComponent(ownerPrincipalId)}` : ''}`, {}, '查询销毁任务');
export const loadKmsWorkerHealth = () => request<KmsWorkerHealth>('/destruction-worker/health', {}, '读取 worker 健康状态');
export interface KmsOwnerDestructionPolicy { ownerPrincipalId: string; exists: boolean; minScheduleAheadSeconds: number | null; maxScheduleAheadSeconds: number | null; rowVersion: number; }
export const getOwnerDestructionPolicy = (ownerPrincipalId: string) => request<KmsOwnerDestructionPolicy>(`/admin/owners/${encodeURIComponent(ownerPrincipalId)}/destruction-policy`, {}, '查询 owner 销毁政策');
export const loadMyDestructionPolicy = () => request<KmsOwnerDestructionPolicy>('/me/destruction-policy', {}, '读取销毁窗口政策');
export const saveMyDestructionPolicy = (input: { minScheduleAheadSeconds: number | null; maxScheduleAheadSeconds: number | null }) => request<KmsOwnerDestructionPolicy>('/me/destruction-policy', { method: 'PUT', body: JSON.stringify(input) }, '保存销毁窗口政策');
