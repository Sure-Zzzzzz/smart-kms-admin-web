import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './kmsApi';
import { kmsState, setKmsMe, type KmsMe } from '../kmsState';

const fetchMock = vi.fn();
const me: KmsMe = { principalId: 'iam:user:1', subjectType: 'HUMAN', scopes: ['kms.key.manage'], pagePermissions: ['kms.page.my-keys'] };

describe('kmsApi', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    kmsState.apiBase = '';
    setKmsMe(null);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{"accepted":true}') });
  });

  afterEach(() => {
    setKmsMe(null);
    vi.unstubAllGlobals();
  });

  it('uses the injected API base with Bearer and no Portal cookie', async () => {
    kmsState.apiBase = '/gateway/kms';
    window.sessionStorage.setItem('kms.accessToken', 'token-1');
    window.sessionStorage.setItem('kms.accessTokenExpiresAt', String(Date.now() + 3_600_000));
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{"items":[],"page":1,"size":20,"total":0}') });

    const result = await api.listKmsKeys({ page: 1, size: 20 });

    expect(result).toEqual({ items: [], page: 1, size: 20, total: 0 });

    expect(fetchMock).toHaveBeenCalledWith('/gateway/kms/keys?page=1&size=20', expect.objectContaining({
      credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer token-1' })
    }));
  });

  it('passes the optional current-permissions cancellation signal to fetch', async () => {
    const controller = new AbortController();
    await api.loadKmsMe(controller.signal);
    expect(fetchMock).toHaveBeenCalledWith('/api/kms/me', expect.objectContaining({ signal: controller.signal }));
  });

  it('clears a stale token and permissions when the KMS resource server returns 401', async () => {
    setKmsMe(me);
    window.sessionStorage.setItem('kms.accessToken', 'token-1');
    window.sessionStorage.setItem('kms.accessTokenExpiresAt', String(Date.now() + 3_600_000));
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('') });

    await expect(api.loadKmsMe()).rejects.toMatchObject({ status: 401, name: 'KmsApiError' });

    expect(window.sessionStorage.getItem('kms.accessToken')).toBeNull();
    expect(window.sessionStorage.getItem('kms.accessTokenExpiresAt')).toBeNull();
    expect(kmsState.me).toBeNull();
    expect(kmsState.meLoaded).toBe(false);
  });

  it.each([
    ['older token', 'token-old', 'token-new', true],
    ['unauthenticated request', null, 'token-new', true],
    ['current token', 'token-current', 'token-current', false]
  ] as const)('handles a delayed 401 from an %s without clearing a newer authorization', async (_label, initialToken, currentToken, retained) => {
    const expiresAt = String(Date.now() + 3_600_000);
    if (initialToken !== null) {
      window.sessionStorage.setItem('kms.accessToken', initialToken);
      window.sessionStorage.setItem('kms.accessTokenExpiresAt', expiresAt);
    }
    let resolveResponse!: (response: { ok: boolean; status: number }) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
    const pending = api.loadKmsMe();
    const rejected = expect(pending).rejects.toMatchObject({ status: 401, name: 'KmsApiError' });
    window.sessionStorage.setItem('kms.accessToken', currentToken);
    window.sessionStorage.setItem('kms.accessTokenExpiresAt', expiresAt);
    const currentMe = { ...me, principalId: 'iam:user:2' };
    setKmsMe(currentMe);

    resolveResponse({ ok: false, status: 401 });
    await rejected;

    expect(window.sessionStorage.getItem('kms.accessToken')).toBe(retained ? currentToken : null);
    expect(window.sessionStorage.getItem('kms.accessTokenExpiresAt')).toBe(retained ? expiresAt : null);
    expect(kmsState.me).toEqual(retained ? currentMe : null);
    expect(kmsState.meLoaded).toBe(retained);
    expect(fetchMock.mock.lastCall?.[1].headers).toEqual(initialToken === null ? {} : { Authorization: `Bearer ${initialToken}` });
  });

  it.each(['missing', 'expired in flight'] as const)('clears cached permissions when credentials are %s on a 401', async outcome => {
    setKmsMe(me);
    if (outcome === 'expired in flight') {
      window.sessionStorage.setItem('kms.accessToken', 'token-current');
      window.sessionStorage.setItem('kms.accessTokenExpiresAt', String(Date.now() + 3_600_000));
    }
    let resolveResponse!: (response: { ok: boolean; status: number }) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
    const rejected = expect(api.loadKmsMe()).rejects.toMatchObject({ status: 401 });
    if (outcome === 'expired in flight') window.sessionStorage.setItem('kms.accessTokenExpiresAt', String(Date.now() - 1));
    resolveResponse({ ok: false, status: 401 });
    await rejected;
    expect(kmsState.me).toBeNull();
    expect(kmsState.meLoaded).toBe(false);
    expect(window.sessionStorage.getItem('kms.accessToken')).toBeNull();
  });

  it('encodes each query and excludes empty or undefined filters while retaining zero', async () => {
    const query = { page: 0, size: 20, alias: 'hello / 密钥', ignored: '', omitted: undefined };
    for (const [list, path] of [
      [api.listKmsKeys, '/keys'],
      [api.listAdminKmsKeys, '/admin/keys'],
      [api.listMyKmsKeys, '/me/keys']
    ] as const) {
      expect(await list(query)).toEqual({ accepted: true });
      const url = new URL(fetchMock.mock.lastCall?.[0] as string, 'https://kms.example');
      expect(url.pathname).toBe(`/api/kms${path}`);
      expect(Object.fromEntries(url.searchParams)).toEqual({ page: '0', size: '20', alias: 'hello / 密钥' });
      expect(fetchMock.mock.lastCall?.[1]).toEqual({ credentials: 'omit', headers: {} });
    }
  });

  it('uses default collection filters and destruction pagination', async () => {
    await api.listKmsKeys();
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/kms/keys?');
    await api.listAdminKmsKeys();
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/kms/admin/keys?');
    await api.listMyKmsKeys();
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/kms/me/keys?');
    await api.listKmsDestructionJobs();
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/kms/destruction-jobs?page=1&size=20');
    await api.listKmsDestructionJobs(3, 10);
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/kms/destruction-jobs?page=3&size=10');
  });

  const resource = 'owner/key?#';
  const encoded = encodeURIComponent(resource);
  const input = { keyAlias: 'primary', purpose: 'SIGN', algorithm: 'ES256' };
  const policy = { principalId: 'iam:user:2', keyVersion: 3, operation: 'SIGN', expiresAt: '2027-01-01T00:00:00Z' };
  const cases: { label: string; call: () => Promise<unknown>; path: string; method?: string; body?: unknown; idempotency?: string }[] = [
    { label: 'current permissions', call: () => api.loadKmsMe(), path: '/me' },
    { label: 'my key detail', call: () => api.getMyKmsKey(resource), path: `/me/keys/${encoded}` },
    { label: 'admin key detail', call: () => api.getAdminKmsKey(resource), path: `/admin/keys/${encoded}` },
    { label: 'key detail', call: () => api.getKmsKey(resource), path: `/keys/${encoded}` },
    { label: 'my public key versions', call: () => api.listMyKmsPublicKeys(resource), path: `/me/keys/${encoded}/public-keys` },
    { label: 'my destruction details', call: () => api.getMyKmsDestruction(resource), path: `/me/keys/${encoded}/destruction` },
    { label: 'admin destruction details', call: () => api.getAdminKmsDestruction(resource), path: `/admin/keys/${encoded}/destruction` },
    { label: 'key creation', call: () => api.createKmsKey(input, 'create-1'), path: '/keys', method: 'POST', body: input, idempotency: 'create-1' },
    { label: 'key state', call: () => api.changeKmsKeyState(resource, 'DISABLED', 5, 'state-1'), path: `/keys/${encoded}/state`, method: 'PATCH', body: { state: 'DISABLED', expectedRowVersion: 5 }, idempotency: 'state-1' },
    { label: 'key rotation', call: () => api.rotateKmsKey(resource, 5, 'rotate-1'), path: `/keys/${encoded}/versions`, method: 'POST', body: { expectedRowVersion: 5 }, idempotency: 'rotate-1' },
    { label: 'destruction scheduling', call: () => api.scheduleKmsDestruction(resource, '2027-01-01T00:00:00Z', 5, 'destroy-1'), path: `/keys/${encoded}/destruction`, method: 'PUT', body: { dueAt: '2027-01-01T00:00:00Z', expectedRowVersion: 5 }, idempotency: 'destroy-1' },
    { label: 'destruction cancellation', call: () => api.cancelKmsDestruction(resource, 5, 'cancel-1'), path: `/keys/${encoded}/destruction`, method: 'DELETE', body: { expectedRowVersion: 5 }, idempotency: 'cancel-1' },
    { label: 'my key state', call: () => api.changeMyKmsKeyState(resource, 'DISABLED', 5, 'my-state-1'), path: `/me/keys/${encoded}/state`, method: 'PATCH', body: { state: 'DISABLED', expectedRowVersion: 5 }, idempotency: 'my-state-1' },
    { label: 'my key rotation', call: () => api.rotateMyKmsKey(resource, 5, 'my-rotate-1'), path: `/me/keys/${encoded}/versions`, method: 'POST', body: { expectedRowVersion: 5 }, idempotency: 'my-rotate-1' },
    { label: 'my destruction scheduling', call: () => api.scheduleMyKmsDestruction(resource, '2027-01-01T00:00:00Z', 5, 'my-destroy-1'), path: `/me/keys/${encoded}/destruction`, method: 'PUT', body: { dueAt: '2027-01-01T00:00:00Z', expectedRowVersion: 5 }, idempotency: 'my-destroy-1' },
    { label: 'my destruction cancellation', call: () => api.cancelMyKmsDestruction(resource, 5, 'my-cancel-1'), path: `/me/keys/${encoded}/destruction`, method: 'DELETE', body: { expectedRowVersion: 5 }, idempotency: 'my-cancel-1' },
    { label: 'policy listing', call: () => api.listKmsPolicies(resource), path: `/keys/${encoded}/policies` },
    { label: 'policy creation', call: () => api.createKmsPolicy(resource, policy, 'policy-1'), path: `/keys/${encoded}/policies`, method: 'POST', body: policy, idempotency: 'policy-1' },
    { label: 'policy revocation', call: () => api.revokeKmsPolicy(resource, 'policy/1', 9, 'revoke-1'), path: `/keys/${encoded}/policies/policy%2F1`, method: 'DELETE', body: { expectedRowVersion: 9 }, idempotency: 'revoke-1' },
    { label: 'worker health', call: () => api.loadKmsWorkerHealth(), path: '/destruction-worker/health' },
    { label: 'owner destruction policy', call: () => api.getOwnerDestructionPolicy(resource), path: `/admin/owners/${encoded}/destruction-policy` },
    { label: 'my destruction policy', call: () => api.loadMyDestructionPolicy(), path: '/me/destruction-policy' },
    { label: 'destruction policy update', call: () => api.saveMyDestructionPolicy({ minScheduleAheadSeconds: null, maxScheduleAheadSeconds: 900 }), path: '/me/destruction-policy', method: 'PUT', body: { minScheduleAheadSeconds: null, maxScheduleAheadSeconds: 900 } }
  ];

  it.each(cases)('assembles $label with the correct resource, concurrency and idempotency fields', async ({ call, path, method, body, idempotency }) => {
    expect(await call()).toEqual({ accepted: true });
    const [url, request] = fetchMock.mock.lastCall as [string, RequestInit];
    expect(url).toBe(`/api/kms${path}`);
    expect(request.credentials).toBe('omit');
    expect(request.method).toBe(method);
    expect(request.body).toBe(body ? JSON.stringify(body) : undefined);
    expect(request.headers).toEqual({
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {})
    });
  });

  it.each([
    [400, '请求参数无效'], [401, '登录状态失效'], [403, '没有执行该操作的权限'],
    [404, '资源不存在或已被删除'], [409, '资源已被并发修改'], [503, '请求失败（HTTP 503）']
  ])('reports HTTP %s without echoing server secrets', async (status, message) => {
    const readResponse = vi.fn().mockResolvedValue('secret-key-material');
    fetchMock.mockResolvedValue({ ok: false, status, text: readResponse });
    await expect(api.loadKmsMe()).rejects.toMatchObject({
      name: 'KmsApiError', status, message: `读取当前权限失败：${message}`
    });
    expect(readResponse).not.toHaveBeenCalled();
  });

  it('accepts 204 and empty successful bodies without parsing them', async () => {
    const readResponse = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: readResponse });
    await expect(api.cancelKmsDestruction('key-1', 1, 'cancel-1')).resolves.toBeUndefined();
    await expect(api.cancelMyKmsDestruction('key-1', 1, 'my-cancel-1')).resolves.toBeUndefined();
    expect(readResponse).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    await expect(api.loadKmsMe()).resolves.toBeUndefined();
  });

  it('rejects malformed JSON and propagates transport failure', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{invalid') });
    await expect(api.loadKmsMe()).rejects.toBeInstanceOf(SyntaxError);
    const failure = new Error('network unavailable');
    fetchMock.mockRejectedValue(failure);
    await expect(api.loadKmsMe()).rejects.toBe(failure);
  });
});
