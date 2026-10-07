import { expect, type Locator, type Page } from '@playwright/test';
import { allScopes, createDestructionJob, createKey, expectNoPageOverflow, mount, refreshIdentity,
  selfServiceScopes, test, type MockState } from './fixtures';

function preparePending(mock: MockState, mode: 'self' | 'governance' = 'self') {
  mock.pagePermissions = [mode === 'self' ? 'kms.page.my-keys' : 'kms.page.keys'];
  mock.scopes = mode === 'self' ? [...selfServiceScopes] : [...allScopes];
  mock.dataAccess = mode === 'self' ? null : 'all';
  mock.keys = [{ ...createKey('PENDING_DESTRUCTION'), activeVersion: 2 }];
  if (mode === 'governance') mock.keys[0]!.ownerPrincipalId = 'iam:other';
  mock.destructionJobs = [createDestructionJob(), createDestructionJob('browser-key-001', 2)];
  mock.statesBeforeDestruction['browser-key-001'] = 'ACTIVE';
}

async function openDetails(page: Page, mode: 'self' | 'governance' = 'self') {
  await mount(page, mode === 'self' ? 'my-keys' : 'keys');
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  return page.getByRole('region', { name: '密钥详情', exact: true });
}

function versionRow(progress: Locator, version: number) {
  return progress.getByRole('row').filter({ has: progress.page().getByRole('cell', { name: String(version), exact: true }) });
}

async function confirm(page: Page, action: '安排销毁' | '取消销毁') {
  await page.getByRole('region', { name: '密钥详情', exact: true }).getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: action === '安排销毁' ? action : '取消销毁任务', exact: true });
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('长归属主体和销毁日期在治理详情抽屉内完整展示且不撑破布局', async ({ page, mock }, testInfo) => {
  preparePending(mock, 'governance');
  const ownerPrincipalId = `aksk:${'W'.repeat(123)}`;
  mock.keys[0]!.ownerPrincipalId = ownerPrincipalId;
  mock.destructionJobs[0]!.dueAt = '2030-12-31T23:59:59.999Z';
  mock.destructionJobs[0]!.state = 'COMPLETED';
  mock.destructionJobs[0]!.attemptCount = 1;
  mock.destructionJobs[0]!.completedAt = '2031-01-01T00:00:59.999Z';
  const details = await openDetails(page, 'governance');
  const policy = details.getByRole('region', { name: '归属人销毁政策', exact: true });
  const hint = policy.locator('.kms-policy-hint').filter({ hasText: ownerPrincipalId }).first();
  await expect(hint).toContainText(ownerPrincipalId);
  expect(await hint.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const progress = details.getByRole('region', { name: '销毁进度', exact: true });
  await expect(versionRow(progress, 1)).toContainText('已完成');
  await expect(versionRow(progress, 1).getByRole('cell').nth(2)).toHaveText(await page.evaluate(value => new Date(value).toLocaleString(), mock.destructionJobs[0]!.dueAt));
  await expect(versionRow(progress, 1).getByRole('cell').nth(3)).toHaveText(await page.evaluate(value => new Date(value).toLocaleString(), mock.destructionJobs[0]!.completedAt!));
  const drawer = page.getByRole('dialog', { name: '订单签名密钥', exact: true });
  const content = drawer.locator('.drawer-content');
  expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const table = progress.locator('.kms-table-wrap');
  const tableBounds = await table.boundingBox();
  const drawerBounds = await drawer.boundingBox();
  expect(tableBounds!.x).toBeGreaterThanOrEqual(drawerBounds!.x);
  expect(tableBounds!.x + tableBounds!.width).toBeLessThanOrEqual(drawerBounds!.x + drawerBounds!.width);
  await expectNoPageOverflow(page);
  await policy.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('long-owner-destruction-details.png'), fullPage: true });
  expect(mock.writes).toEqual([]);
});

for (const mode of ['self', 'governance'] as const) {
  test(`${mode}安排真实版本任务，重开和刷新回读领取及部分完成，取消资格随服务端变化`, async ({ page, mock }, testInfo) => {
    preparePending(mock, mode);
    mock.keys[0]!.state = 'ACTIVE';
    mock.destructionJobs = [];
    const details = await openDetails(page, mode);
    const dueAt = await page.evaluate(() => {
      const date = new Date(Date.now() + 24 * 3_600_000);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    });
    await details.getByLabel('销毁时间', { exact: true }).fill(dueAt);
    await confirm(page, '安排销毁');
    const progress = details.getByRole('region', { name: '销毁进度', exact: true });
    await expect(versionRow(progress, 1)).toContainText('等待执行');
    await expect(versionRow(progress, 2)).toContainText('等待执行');
    await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toBeEnabled();
    expect(mock.destructionJobs).toHaveLength(2);
    expect(mock.destructionJobs.every(job => job.dueAt === new Date(dueAt).toISOString())).toBe(true);
    const prefix = mode === 'self' ? '/me' : '/admin';
    expect(mock.reads).toContain(`${prefix}/keys/browser-key-001/destruction`);
    expect(mock.reads.some(path => path.startsWith(`${mode === 'self' ? '/admin' : '/me'}/keys`))).toBe(false);

    await page.getByRole('dialog', { name: '订单签名密钥', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    mock.destructionJobs[0]!.state = 'CLAIMED';
    mock.destructionJobs[0]!.attemptCount = 1;
    mock.destructionJobs[0]!.claimUntil = '2030-01-02T10:01:00.000Z';
    await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
    await expect(versionRow(progress, 1)).toContainText('执行中');
    await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
    mock.destructionJobs[0]!.state = 'COMPLETED';
    mock.destructionJobs[0]!.claimUntil = null;
    mock.destructionJobs[0]!.completedAt = '2030-01-02T10:02:00.000Z';
    await progress.getByRole('button', { name: '刷新销毁进度', exact: true }).click();
    await expect(versionRow(progress, 1)).toContainText('已完成');
    await expect(versionRow(progress, 2)).toContainText('等待执行');
    await expect(progress).toContainText('任务一旦被后台领取过就不能取消');
    await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
    expect(mock.reads.filter(path => path === `${prefix}/keys/browser-key-001/destruction`)).toHaveLength(4);
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0]!.path).toBe(`${mode === 'self' ? '/me' : ''}/keys/browser-key-001/destruction`);
    await expectNoPageOverflow(page);
    await progress.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-destruction-progress.png`), fullPage: true });
    mock.destructionJobs[1]!.state = 'COMPLETED';
    mock.destructionJobs[1]!.attemptCount = 1;
    mock.destructionJobs[1]!.completedAt = '2030-01-02T10:03:00.000Z';
    mock.keys[0]!.state = 'DESTROYED';
    mock.keys[0]!.activeVersion = null;
    mock.keys[0]!.rowVersion += 1;
    await progress.getByRole('button', { name: '刷新销毁进度', exact: true }).click();
    await expect(versionRow(progress, 1)).toContainText('已完成');
    await expect(versionRow(progress, 2)).toContainText('已完成');
    await expect(details).toContainText('DESTROYED');
    await expect(progress.getByRole('button', { name: '刷新销毁进度', exact: true })).toHaveCount(0);
    expect(mock.writes).toHaveLength(1);
  });
}

test('曾领取的PENDING任务不能取消，读取资格与写权限分开核验', async ({ page, mock }) => {
  preparePending(mock);
  mock.destructionJobs[0]!.attemptCount = 1;
  const details = await openDetails(page);
  const progress = details.getByRole('region', { name: '销毁进度', exact: true });
  await expect(versionRow(progress, 1)).toContainText('等待执行');
  await expect(progress).toContainText('任务一旦被后台领取过就不能取消');
  await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
  const before = structuredClone(mock.destructionJobs);
  const status = await page.evaluate(async () => (await fetch('/api/kms/me/keys/browser-key-001/destruction', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token', 'Idempotency-Key': 'claimed-cancel' },
    body: JSON.stringify({ expectedRowVersion: 1 })
  })).status);
  expect(status).toBe(409);
  expect(mock.destructionJobs).toEqual(before);
  expect(mock.keys[0]!.state).toBe('PENDING_DESTRUCTION');
  await expectNoPageOverflow(page);
});

test('仅key.read能看销毁明细和资格，但没有销毁政策与取消写入口', async ({ page, mock }) => {
  preparePending(mock);
  mock.scopes = ['kms.me.read', 'kms.key.read'];
  const details = await openDetails(page);
  const progress = details.getByRole('region', { name: '销毁进度', exact: true });
  await expect(versionRow(progress, 1)).toContainText('等待执行');
  await expect(details.getByRole('region', { name: '归属人销毁政策', exact: true })).toHaveCount(0);
  await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
  expect(mock.reads).toContain('/me/keys/browser-key-001/destruction');
  expect(mock.reads.some(path => path.includes('/destruction-policy'))).toBe(false);
  const summary = await page.evaluate(async () => (await fetch('/api/kms/me/keys/browser-key-001/destruction', {
    headers: { Authorization: 'Bearer browser-fixture-token' }
  })).json());
  expect(summary.cancelEligible).toBe(true);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

test('取消后明细为空，重开抽屉仍无任务且没有二次写入', async ({ page, mock }) => {
  preparePending(mock);
  const details = await openDetails(page);
  await confirm(page, '取消销毁');
  const progress = details.getByRole('region', { name: '销毁进度', exact: true });
  await expect(progress).toContainText('暂无销毁任务');
  await expect(progress.getByRole('table')).toHaveCount(0);
  expect(mock.destructionJobs).toEqual([]);
  expect(mock.keys[0]).toMatchObject({ state: 'ACTIVE', rowVersion: 2 });
  await page.getByRole('dialog', { name: '订单签名密钥', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  await expect(progress).toContainText('暂无销毁任务');
  expect(mock.writes).toEqual([{ method: 'DELETE', path: '/me/keys/browser-key-001/destruction', body: { expectedRowVersion: 1 } }]);
  await expectNoPageOverflow(page);
});

for (const mode of ['self', 'governance'] as const) {
  test(`${mode}销毁明细503不保留取消入口，重试重新读元数据和对应明细`, async ({ page, mock }) => {
    preparePending(mock, mode);
    mock.destructionDetailStatus = 503;
    const details = await openDetails(page, mode);
    const progress = details.getByRole('region', { name: '销毁进度', exact: true });
    await expect(progress.getByRole('alert')).toContainText('HTTP 503');
    await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
    await expect(progress).not.toContainText('暂无销毁任务');
    mock.destructionDetailStatus = 200;
    await progress.getByRole('button', { name: '重新读取销毁详情', exact: true }).click();
    await expect(versionRow(progress, 1)).toContainText('等待执行');
    await expect(progress.getByRole('button', { name: '取消销毁', exact: true })).toBeEnabled();
    const prefix = mode === 'self' ? '/me' : '/admin';
    expect(mock.reads.filter(path => path === `${prefix}/keys/browser-key-001`)).toHaveLength(2);
    expect(mock.reads.filter(path => path === `${prefix}/keys/browser-key-001/destruction`)).toHaveLength(2);
    expect(mock.writes).toEqual([]);
    await expectNoPageOverflow(page);
  });
}

for (const mismatch of ['keyRef', 'rowVersion', 'keyState'] as const) {
  test(`销毁${mismatch}持续失配最多自动回读一次，人工重试恢复前不提供取消`, async ({ page, mock }) => {
    preparePending(mock);
    mock.destructionDetailMismatch = mismatch;
    const details = await openDetails(page);
    await expect(details.getByRole('alert')).toContainText('密钥状态与销毁详情已变化');
    await expect(details.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
    expect(mock.reads.filter(path => path === '/me/keys/browser-key-001')).toHaveLength(2);
    expect(mock.reads.filter(path => path === '/me/keys/browser-key-001/destruction')).toHaveLength(2);
    mock.destructionDetailMismatch = null;
    await details.getByRole('button', { name: '重新读取详情', exact: true }).click();
    await expect(details.getByRole('button', { name: '取消销毁', exact: true })).toBeEnabled();
    expect(mock.reads.filter(path => path === '/me/keys/browser-key-001')).toHaveLength(3);
    expect(mock.writes).toEqual([]);
  });
}

for (const action of ['安排销毁', '取消销毁'] as const) {
  test(`${action}写成功后明细读失败只重试读取，保留成功结果且不重写命令`, async ({ page, mock }) => {
    preparePending(mock);
    if (action === '安排销毁') { mock.keys[0]!.state = 'ACTIVE'; mock.destructionJobs = []; }
    const details = await openDetails(page);
    if (action === '安排销毁') {
      await details.getByLabel('销毁时间', { exact: true }).fill('2030-01-02T10:00');
    }
    mock.destructionDetailStatusAfterWrite = 503;
    await confirm(page, action);
    const progress = details.getByRole('region', { name: '销毁进度', exact: true });
    await expect(details.getByRole('status')).toContainText(`${action}成功`);
    await expect(progress.getByRole('alert')).toContainText('HTTP 503');
    expect(mock.writes).toHaveLength(1);
    mock.destructionDetailStatus = 200;
    await progress.getByRole('button', { name: '重新读取销毁详情', exact: true }).click();
    if (action === '安排销毁') await expect(versionRow(progress, 2)).toContainText('等待执行');
    else await expect(progress).toContainText('暂无销毁任务');
    expect(mock.writes).toHaveLength(1);
    expect(mock.idempotencyKeys).toHaveLength(1);
    await expect(details.getByRole('status')).toContainText(`${action}成功`);
    await expectNoPageOverflow(page);
  });
}

for (const failure of ['before', 'after'] as const) {
  test(`取消${failure === 'before' ? '提交前断网' : '提交后丢失响应'}保留原确认与正文幂等键，重放仅取消一次`, async ({ page, mock }) => {
    preparePending(mock);
    mock.cancelNetworkFailure = failure;
    const details = await openDetails(page);
    await details.getByRole('button', { name: '取消销毁', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '取消销毁任务', exact: true });
    await dialog.getByRole('button', { name: '取消销毁', exact: true }).click();
    await expect(dialog).toContainText('Failed to fetch');
    expect(mock.keys[0]!.state).toBe(failure === 'before' ? 'PENDING_DESTRUCTION' : 'ACTIVE');
    expect(mock.destructionJobs).toHaveLength(failure === 'before' ? 2 : 0);
    await expect(details.getByRole('button', { name: '刷新销毁进度', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '取消销毁', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(details.getByRole('region', { name: '销毁进度', exact: true })).toContainText('暂无销毁任务');
    expect(mock.writes).toEqual([
      { method: 'DELETE', path: '/me/keys/browser-key-001/destruction', body: { expectedRowVersion: 1 } },
      { method: 'DELETE', path: '/me/keys/browser-key-001/destruction', body: { expectedRowVersion: 1 } }
    ]);
    expect(mock.idempotencyKeys[0]).toBeTruthy();
    expect(mock.idempotencyKeys[1]).toBe(mock.idempotencyKeys[0]);
    expect(mock.keys[0]!.rowVersion).toBe(2);
    expect(mock.destructionJobs).toEqual([]);
    await expectNoPageOverflow(page);
  });
}

test('确认期间后台曾领取导致取消409，自动回读真实资格而不重试写', async ({ page, mock }) => {
  preparePending(mock);
  const details = await openDetails(page);
  await details.getByRole('button', { name: '取消销毁', exact: true }).click();
  mock.destructionJobs[0]!.attemptCount = 1;
  await page.getByRole('alertdialog').getByRole('button', { name: '取消销毁', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(details.getByRole('alert')).toContainText('请核对重新读取的详情后重新确认操作');
  await expect(details.getByRole('region', { name: '销毁进度', exact: true })).toContainText('任务一旦被后台领取过就不能取消');
  await expect(details.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
  expect(mock.writes).toHaveLength(1);
  expect(mock.keys[0]).toMatchObject({ state: 'PENDING_DESTRUCTION', rowVersion: 1 });
  expect(mock.reads.filter(path => path === '/me/keys/browser-key-001/destruction')).toHaveLength(2);
});

test('同主体撤销destroy权限会关闭待确认取消，明细仍可读且没有写入', async ({ page, mock }) => {
  preparePending(mock);
  const details = await openDetails(page);
  await details.getByRole('button', { name: '取消销毁', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  mock.scopes = mock.scopes.filter(scope => scope !== 'kms.key.destroy');
  const permissionResponse = page.waitForResponse(response => response.url().endsWith('/api/kms/me'));
  await refreshIdentity(page, 1);
  await permissionResponse;
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(details.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
  await expect(versionRow(details.getByRole('region', { name: '销毁进度', exact: true }), 1)).toContainText('等待执行');
  expect(mock.writes).toEqual([]);
});

test('明细迟到期间同主体撤销read权限，旧任务不能回填或留下取消入口', async ({ page, mock }) => {
  preparePending(mock);
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let started = () => {};
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/kms/me/keys/browser-key-001/destruction', async route => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    mock.reads.push('/me/keys/browser-key-001/destruction');
    started();
    await released;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      keyRef: 'browser-key-001', keyState: 'PENDING_DESTRUCTION', rowVersion: 1, cancelEligible: true,
      items: [{ keyVersion: 1, state: 'PENDING', dueAt: '2030-01-02T10:00:00.000Z', completedAt: null }]
    }) });
  });
  try {
    const details = await openDetails(page);
    await requestStarted;
    mock.scopes = mock.scopes.filter(scope => scope !== 'kms.key.read');
    const permissionResponse = page.waitForResponse(response => response.url().endsWith('/api/kms/me'));
    await refreshIdentity(page, 1);
    await permissionResponse;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(details).toHaveCount(0);
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/kms/me/keys/browser-key-001/destruction'));
    release();
    await lateResponse;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('region', { name: '销毁进度', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
    await expect(page.getByRole('table')).not.toContainText('订单签名密钥');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(mock.writes).toEqual([]);
  } finally { release(); }
});

test('取消提交后同主体撤销destroy，迟到成功不恢复写入口或触发自动回读，人工刷新核对结果', async ({ page, mock }) => {
  preparePending(mock);
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let started = () => {};
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/kms/me/keys/browser-key-001/destruction', async route => {
    const request = route.request();
    if (request.method() !== 'DELETE') { await route.fallback(); return; }
    mock.writes.push({ method: 'DELETE', path: '/me/keys/browser-key-001/destruction', body: request.postDataJSON() });
    mock.idempotencyKeys.push(request.headers()['idempotency-key'] || '');
    mock.keys[0]!.state = 'ACTIVE';
    mock.keys[0]!.rowVersion += 1;
    mock.destructionJobs = [];
    started();
    await released;
    await route.fulfill({ status: 204 });
  });
  try {
    const details = await openDetails(page);
    await details.getByRole('button', { name: '取消销毁', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '取消销毁', exact: true }).click();
    await requestStarted;
    const detailReads = mock.reads.filter(path => path === '/me/keys/browser-key-001').length;
    mock.scopes = mock.scopes.filter(scope => scope !== 'kms.key.destroy');
    const permissionResponse = page.waitForResponse(response => response.url().endsWith('/api/kms/me'));
    await refreshIdentity(page, 1);
    await permissionResponse;
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/kms/me/keys/browser-key-001/destruction')
      && response.request().method() === 'DELETE');
    release();
    await lateResponse;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(details.getByRole('button', { name: '取消销毁', exact: true })).toHaveCount(0);
    await expect(details.getByRole('status')).toHaveCount(0);
    expect(mock.reads.filter(path => path === '/me/keys/browser-key-001')).toHaveLength(detailReads);
    expect(mock.writes).toHaveLength(1);
    await details.getByRole('button', { name: '刷新销毁进度', exact: true }).click();
    await expect(details.getByRole('region', { name: '销毁进度', exact: true })).toContainText('暂无销毁任务');
    expect(mock.writes).toHaveLength(1);
  } finally { release(); }
});
