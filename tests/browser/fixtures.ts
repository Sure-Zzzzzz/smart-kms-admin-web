import { expect, test as base, type Page } from '@playwright/test';

export const allPagePermissions = ['kms.page.my-keys', 'kms.page.keys', 'kms.page.policies', 'kms.page.destruction'];
export const allScopes = ['kms.me.read', 'kms.key.read', 'kms.key.manage', 'kms.key.destroy', 'kms.key.policy', 'kms.read-public-key'];
export const selfServiceScopes = ['kms.me.read', 'kms.key.read', 'kms.key.manage', 'kms.key.destroy', 'kms.read-public-key'];

export interface MockKey {
  ownerPrincipalId: string;
  keyRef: string;
  keyAlias: string;
  purpose: string;
  algorithm: string;
  state: string;
  activeVersion: number | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface MockPublicKey {
  keyRef: string;
  version: number;
  algorithm: 'ES256';
  state: string;
  publicKey: string;
}

export interface MockDestructionJob {
  keyRef: string;
  keyVersion: number;
  state: 'PENDING' | 'CLAIMED' | 'COMPLETED';
  dueAt: string;
  claimUntil: string | null;
  attemptCount: number;
  completedAt: string | null;
}

export interface MockState {
  principalId: string;
  subjectType: 'HUMAN' | 'SERVICE';
  pagePermissions: string[];
  scopes: string[];
  dataAccess: 'all' | null;
  keys: MockKey[];
  keyListStatus: number;
  keyDetailStatus: number;
  rotationStatus: number;
  rotationNetworkFailure: 'before' | 'after' | null;
  publicKeyStatus: number;
  legacyPublicKeyPolicyVersions: Record<string, number[] | 'all'>;
  publicKeys: MockPublicKey[];
  destructionJobs: MockDestructionJob[];
  destructionJobsStatus: number;
  destructionDetailStatus: number;
  destructionDetailStatusAfterWrite: number | null;
  destructionDetailMismatch: 'keyRef' | 'rowVersion' | 'keyState' | null;
  cancelNetworkFailure: 'before' | 'after' | null;
  workerHealthStatus: number;
  statesBeforeDestruction: Record<string, string>;
  myDestructionPolicy: { exists: boolean; minScheduleAheadSeconds: number | null; maxScheduleAheadSeconds: number | null };
  reads: string[];
  idempotencyKeys: string[];
  writes: { method: string; path: string; body: unknown }[];
  unexpectedRequests: string[];
}

export function createKey(state = 'ACTIVE'): MockKey {
  return {
    ownerPrincipalId: 'iam:browser-user', keyRef: 'browser-key-001', keyAlias: '订单签名密钥',
    purpose: 'SIGN', algorithm: 'ES256', state, activeVersion: 1, rowVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  };
}

export function createDestructionJob(keyRef = 'browser-key-001', keyVersion = 1,
  state: MockDestructionJob['state'] = 'PENDING'): MockDestructionJob {
  return { keyRef, keyVersion, state, dueAt: '2030-01-02T10:00:00.000Z',
    claimUntil: state === 'CLAIMED' ? '2030-01-02T10:01:00.000Z' : null,
    attemptCount: state === 'PENDING' ? 0 : 1,
    completedAt: state === 'COMPLETED' ? '2030-01-02T10:02:00.000Z' : null };
}

type Fixtures = { mock: MockState };
export const test = base.extend<Fixtures>({
  mock: [async ({ page }, use) => {
    const mock: MockState = {
      principalId: 'iam:browser-user', subjectType: 'HUMAN',
      pagePermissions: [...allPagePermissions], scopes: [...allScopes], keys: [createKey()],
      dataAccess: 'all', rotationNetworkFailure: null,
      keyListStatus: 200, keyDetailStatus: 200, rotationStatus: 200, publicKeyStatus: 200, legacyPublicKeyPolicyVersions: {},
      publicKeys: [{ keyRef: 'browser-key-001', version: 1, algorithm: 'ES256', state: 'ACTIVE', publicKey: 'BrowserFixturePublicKey'.repeat(12) }],
      destructionJobs: [], destructionJobsStatus: 200, workerHealthStatus: 200,
      destructionDetailStatus: 200, destructionDetailStatusAfterWrite: null, destructionDetailMismatch: null, cancelNetworkFailure: null,
      myDestructionPolicy: { exists: false, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null },
      statesBeforeDestruction: {}, reads: [], idempotencyKeys: [], writes: [], unexpectedRequests: []
    };
    const replays = new Map<string, { body: string; result: MockKey | undefined }>();
    function metadata(key: MockKey, self: boolean) {
      if (!self) return key;
      const { keyRef, keyAlias, purpose, algorithm, state, activeVersion, rowVersion, createdAt, updatedAt } = key;
      return { keyRef, keyAlias, purpose, algorithm, state, activeVersion, rowVersion, createdAt, updatedAt };
    }
    function canCancel(key: MockKey) {
      const jobs = mock.destructionJobs.filter(job => job.keyRef === key.keyRef);
      return key.state === 'PENDING_DESTRUCTION' && jobs.length > 0
        && jobs.every(job => job.state === 'PENDING' && job.attemptCount === 0 && job.claimUntil === null && job.completedAt === null);
    }
    page.on('dialog', async dialog => {
      mock.unexpectedRequests.push(`原生对话框：${dialog.type()}`);
      await dialog.dismiss();
    });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        mock.unexpectedRequests.push(request.url());
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/oauth2/')) {
        await route.continue();
        return;
      }
      const path = url.pathname.replace(/^\/api\/kms/, '');
      const method = request.method();
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/oauth2/')) {
        mock.unexpectedRequests.push(`${method} ${url.pathname}`);
        await json({ error: '验收夹具不执行真实授权' }, 400);
        return;
      }
      if (method === 'GET') mock.reads.push(`${path}${url.search}`);
      else {
        mock.writes.push({ method, path, body: request.postData() ? request.postDataJSON() : null });
        mock.idempotencyKeys.push(request.headers()['idempotency-key'] || '');
      }
      const requiredScope = path === '/me' ? 'kms.me.read'
        : /\/public-keys?$/.test(path) ? 'kms.read-public-key'
          : path.includes('/policies') ? 'kms.key.policy'
            : method === 'GET' && /^\/(?:me|admin)\/keys\/[^/]+\/destruction$/.test(path) ? 'kms.key.read'
          : ['/destruction-jobs', '/destruction-worker/health'].includes(path) || path.endsWith('/destruction-policy') || path.endsWith('/destruction') ? 'kms.key.destroy'
            : method === 'GET' ? 'kms.key.read' : 'kms.key.manage';
      if (!mock.scopes.includes(requiredScope)) {
        await json({ error: '权限不足' }, 403);
        return;
      }
      // 旧治理入口要求 DATA；本人接口由认证主体固定归属，DATA=null 也允许本人写。
      if (mock.dataAccess === null && (path.startsWith('/admin/') || /^\/keys\/[^/]+\/(?:state|versions|destruction)$/.test(path))) {
        await json({ error: '数据范围未授权' }, 403);
        return;
      }
      if (path === '/me') {
        await json({ principalId: mock.principalId, subjectType: mock.subjectType, scopes: mock.scopes, pagePermissions: mock.pagePermissions });
      } else if (method === 'GET' && ['/admin/keys', '/me/keys', '/keys'].includes(path)) {
        const items = mock.keys.filter(key => (path !== '/me/keys' || key.ownerPrincipalId === mock.principalId)
          && (!url.searchParams.get('state') || key.state === url.searchParams.get('state'))
          && (!url.searchParams.get('alias') || key.keyAlias.includes(url.searchParams.get('alias') || '')));
        const page = Number(url.searchParams.get('page') || 1);
        const size = Number(url.searchParams.get('size') || 100);
        await json({ items: items.slice((page - 1) * size, page * size).map(key => metadata(key, path === '/me/keys')), page, size, total: items.length }, mock.keyListStatus);
      } else if (method === 'GET' && /^\/(?:me\/|admin\/)?keys\/[^/]+$/.test(path)) {
        const keyRef = decodeURIComponent(path.split('/').at(-1) || '');
        const self = path.startsWith('/me/');
        const key = mock.keys.find(item => item.keyRef === keyRef && (!self || item.ownerPrincipalId === mock.principalId));
        await json(key ? metadata(key, self) : { error: '资源不存在' }, key ? mock.keyDetailStatus : 404);
      } else if (path === '/keys' && method === 'POST') {
        const body = request.postDataJSON() as Record<string, string>;
        const key = { ...createKey(), ownerPrincipalId: mock.principalId, ...body, keyRef: `browser-key-${mock.keys.length + 1}` };
        mock.keys.push(key);
        await json(metadata(key, true));
      } else if (method === 'GET' && /^\/(?:me\/)?keys\/[^/]+\/public-keys?$/.test(path)) {
        const keyRef = decodeURIComponent(path.split('/').at(-2) || '');
        const self = path.startsWith('/me/');
        if (self && mock.subjectType !== 'HUMAN') { await json({ error: '仅人员主体可读取本人公钥' }, 403); return; }
        const key = mock.keys.find(item => item.keyRef === keyRef && item.ownerPrincipalId === mock.principalId);
        if (!key) { await json({ error: '资源不存在' }, 404); return; }
        if (key.algorithm !== 'ES256' || key.purpose !== 'SIGN') { await json({ error: '密钥没有公钥' }, 409); return; }
        if (!['ACTIVE', 'DISABLED'].includes(key.state)) { await json({ error: '密钥不再分发公钥' }, 409); return; }
        const keys = mock.publicKeys.filter(item => item.keyRef === keyRef);
        if (!self) {
          const versions = mock.legacyPublicKeyPolicyVersions[keyRef] || [];
          const required = path.endsWith('/public-keys') ? keys.map(item => item.version)
            : [Number(url.searchParams.get('version') || key.activeVersion)];
          if (versions !== 'all' && !required.every(version => versions.includes(version))) {
            await json({ error: '缺少有效的读取公钥使用策略' }, 403); return;
          }
        }
        if (path.endsWith('/public-keys')) await json(keys, mock.publicKeyStatus);
        else await json(keys.find(key => key.version === Number(url.searchParams.get('version'))) || keys.at(-1), mock.publicKeyStatus);
      } else if (method === 'GET' && /^\/(?:me|admin)\/keys\/[^/]+\/destruction$/.test(path)) {
        const self = path.startsWith('/me/');
        const keyRef = decodeURIComponent(path.split('/').at(-2) || '');
        if (self && mock.subjectType !== 'HUMAN') { await json({ error: '仅人员主体可读取本人销毁明细' }, 403); return; }
        const key = mock.keys.find(item => item.keyRef === keyRef && (!self || item.ownerPrincipalId === mock.principalId));
        if (!key) { await json({ error: '资源不存在' }, 404); return; }
        const summary = {
          keyRef: mock.destructionDetailMismatch === 'keyRef' ? 'different-key' : keyRef,
          keyState: mock.destructionDetailMismatch === 'keyState' ? 'ACTIVE' : key.state,
          rowVersion: key.rowVersion + (mock.destructionDetailMismatch === 'rowVersion' ? 1 : 0),
          cancelEligible: canCancel(key),
          items: mock.destructionJobs.filter(job => job.keyRef === keyRef).map(job => ({
            keyVersion: job.keyVersion, state: job.state, dueAt: job.dueAt, completedAt: job.completedAt
          }))
        };
        await json(summary, mock.destructionDetailStatus);
      } else if (method !== 'GET' && /^\/(?:me\/)?keys\/[^/]+\/(?:state|versions|destruction)$/.test(path)) {
        const self = path.startsWith('/me/');
        const keyRef = decodeURIComponent(path.split('/').at(-2) || '');
        const key = mock.keys.find(item => item.keyRef === keyRef && (!self || item.ownerPrincipalId === mock.principalId));
        if (!key) {
          await json({ error: '资源不存在' }, 404);
          return;
        }
        const body = request.postDataJSON() as { state?: string; expectedRowVersion: number; dueAt?: string };
        const idempotency = request.headers()['idempotency-key'];
        if (!idempotency) {
          await json({ error: '缺少幂等标识' }, 400);
          return;
        }
        const replayKey = `${key.ownerPrincipalId}:${method}:${path}:${idempotency}`;
        const previous = replays.get(replayKey);
        if (previous) {
          if (previous.body !== request.postData()) await json({ error: '幂等标识与请求不一致' }, 409);
          else if (!previous.result) await route.fulfill({ status: 204 });
          else await json(metadata(previous.result, self));
          return;
        }
        if (path.endsWith('/versions') && mock.rotationNetworkFailure === 'before') {
          mock.rotationNetworkFailure = null;
          await route.abort('failed');
          return;
        }
        if (path.endsWith('/destruction') && method === 'DELETE' && mock.cancelNetworkFailure === 'before') {
          mock.cancelNetworkFailure = null;
          await route.abort('failed');
          return;
        }
        if (path.endsWith('/versions') && mock.rotationStatus !== 200) {
          await json({ error: '轮换失败' }, mock.rotationStatus);
          return;
        }
        if (body.expectedRowVersion !== key.rowVersion) {
          await json({ error: '资源版本已变更' }, 409);
          return;
        }
        if (path.endsWith('/state') && method === 'PATCH') {
          if (!['ACTIVE', 'DISABLED'].includes(body.state || '')) {
            await json({ error: '非法目标状态' }, 400);
            return;
          }
          if (!['ACTIVE', 'DISABLED'].includes(key.state) || key.state === body.state) {
            await json({ error: '非法状态迁移' }, 409);
            return;
          }
          key.state = body.state!;
        }
        else if (path.endsWith('/versions') && method === 'POST') {
          if (key.state !== 'ACTIVE') { await json({ error: '非法状态迁移' }, 409); return; }
          key.activeVersion = (key.activeVersion || 0) + 1;
          if (key.algorithm === 'ES256') {
            mock.publicKeys = mock.publicKeys.map(item => item.keyRef === keyRef && item.state === 'ACTIVE' ? { ...item, state: 'RETIRED' } : item);
            mock.publicKeys.push({ keyRef, version: key.activeVersion, algorithm: 'ES256', state: 'ACTIVE', publicKey: `BrowserFixtureVersion${key.activeVersion}PublicKey`.repeat(12) });
          }
        }
        else if (path.endsWith('/destruction') && method === 'PUT') {
          if (!['ACTIVE', 'DISABLED'].includes(key.state)) { await json({ error: '非法状态迁移' }, 409); return; }
          const ahead = (new Date(body.dueAt || '').getTime() - Date.now()) / 1000;
          const policy = mock.myDestructionPolicy;
          if (!Number.isFinite(ahead) || ahead <= 0
            || (policy.minScheduleAheadSeconds !== null && ahead < policy.minScheduleAheadSeconds)
            || (policy.maxScheduleAheadSeconds !== null && ahead > policy.maxScheduleAheadSeconds)) {
            await json({ error: '销毁时间超出允许窗口' }, 400);
            return;
          }
          mock.statesBeforeDestruction[keyRef] = key.state;
          key.state = 'PENDING_DESTRUCTION';
          mock.destructionJobs = mock.destructionJobs.filter(job => job.keyRef !== keyRef);
          for (let version = 1; version <= (key.activeVersion || 0); version += 1) {
            mock.destructionJobs.push({ keyRef, keyVersion: version, state: 'PENDING', dueAt: body.dueAt!,
              claimUntil: null, attemptCount: 0, completedAt: null });
          }
        } else if (path.endsWith('/destruction') && method === 'DELETE') {
          if (!canCancel(key)) { await json({ error: '销毁任务已领取或已完成，不允许取消' }, 409); return; }
          key.state = mock.statesBeforeDestruction[keyRef] || 'DISABLED';
          delete mock.statesBeforeDestruction[keyRef];
          mock.destructionJobs = mock.destructionJobs.filter(job => job.keyRef !== keyRef);
        }
        else {
          mock.unexpectedRequests.push(`${method} ${url.pathname}`);
          await json({ error: '未声明的测试接口' }, 500);
          return;
        }
        key.rowVersion += 1;
        key.updatedAt = new Date().toISOString();
        replays.set(replayKey, { body: request.postData() || '', result: method === 'DELETE' ? undefined : { ...key } });
        if (path.endsWith('/destruction') && mock.destructionDetailStatusAfterWrite !== null) {
          mock.destructionDetailStatus = mock.destructionDetailStatusAfterWrite;
          mock.destructionDetailStatusAfterWrite = null;
        }
        if (path.endsWith('/versions') && mock.rotationNetworkFailure === 'after') {
          mock.rotationNetworkFailure = null;
          await route.abort('failed');
          return;
        }
        if (path.endsWith('/destruction') && method === 'DELETE' && mock.cancelNetworkFailure === 'after') {
          mock.cancelNetworkFailure = null;
          await route.abort('failed');
          return;
        }
        if (method === 'DELETE') await route.fulfill({ status: 204 });
        else await json(metadata(key, self));
      } else if (path.endsWith('/destruction-policy')) {
        if (path === '/me/destruction-policy' && method === 'PUT') {
          mock.myDestructionPolicy = { exists: true, ...request.postDataJSON() };
        }
        await json({ ownerPrincipalId: mock.principalId, ...mock.myDestructionPolicy, rowVersion: 1 });
      } else if (path === '/admin/policies' && method === 'GET') {
        const all = mock.keys.map((key, index) => ({
          policyId: `browser-policy-${index + 1}`, keyRef: key.keyRef, keyAlias: key.keyAlias,
          ownerPrincipalId: key.ownerPrincipalId ?? mock.principalId, principalId: 'iam:browser-subject',
          keyVersion: null, operation: 'SIGN', expiresAt: null, rowVersion: 1, createdAt: '2026-01-01T00:00:00Z'
        })).filter(item => (!url.searchParams.get('keyAlias') || item.keyAlias.includes(url.searchParams.get('keyAlias') || ''))
          && (!url.searchParams.get('principalId') || item.principalId === url.searchParams.get('principalId'))
          && (!url.searchParams.get('operation') || item.operation === url.searchParams.get('operation')));
        const adminPolicyPage = Number(url.searchParams.get('page') || 1);
        const adminPolicySize = Number(url.searchParams.get('size') || 100);
        await json({ items: all.slice((adminPolicyPage - 1) * adminPolicySize, adminPolicyPage * adminPolicySize), page: adminPolicyPage, size: adminPolicySize, total: all.length });
      } else if (path.endsWith('/policies') && method === 'GET') {
        const keyRef = decodeURIComponent(path.split('/').at(-2) || '');
        await json({ items: [{ policyId: 'browser-policy-001', keyRef, principalId: 'iam:browser-subject', keyVersion: null, operation: 'SIGN', expiresAt: null, rowVersion: 1 }] });
      } else if (path.includes('/policies/') && method === 'DELETE') {
        await route.fulfill({ status: 204 });
      } else if (path === '/destruction-jobs') {
        const page = Number(url.searchParams.get('page') || 1);
        const size = Number(url.searchParams.get('size') || 20);
        await json({ items: mock.destructionJobs.slice((page - 1) * size, page * size), page, size, total: mock.destructionJobs.length }, mock.destructionJobsStatus);
      } else if (path === '/destruction-worker/health') {
        await json({ running: true, instanceId: 'browser-worker', claimable: true, lastSuccessfulScanAt: '2026-01-01T00:00:00Z', consecutiveFailureCount: 0, oldestOverdueDelayMillis: 0 }, mock.workerHealthStatus);
      } else {
        mock.unexpectedRequests.push(`${method} ${url.pathname}`);
        await json({ error: '未声明的测试接口' }, 500);
      }
    });
    await page.addInitScript(() => {
      sessionStorage.setItem('kms.accessToken', 'browser-fixture-token');
      sessionStorage.setItem('kms.accessTokenExpiresAt', String(Date.now() + 3_600_000));
    });
    await use(mock);
    expect(mock.unexpectedRequests, '所有后端请求必须由受控夹具处理').toEqual([]);
  }, { auto: true }]
});

export async function mount(page: Page, path = 'my-keys') {
  await page.goto(`/app/kms/${path}`);
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __kmsFixture?: { ready: boolean } }).__kmsFixture?.ready))).toBe(true);
  await expect(page.locator('#micro-app .kms-admin-app')).toBeVisible();
  await expect(page.locator('#micro-app [data-qiankun]')).toHaveCount(1);
}

export async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => ({ viewport: window.innerWidth, width: document.documentElement.scrollWidth })))
    .toEqual({ viewport: page.viewportSize()?.width, width: page.viewportSize()?.width });
}

export async function refreshIdentity(page: Page, revision: number) {
  await page.evaluate(value => {
    const url = new URL(window.location.href);
    url.searchParams.set('permissionCheck', String(value));
    window.history.pushState(window.history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, revision);
}
