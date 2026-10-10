import { expect, type Page } from '@playwright/test';
import { createKey, expectNoPageOverflow, mount, selfServiceScopes, test } from './fixtures';

async function confirmOperation(page: Page, action: string) {
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await details.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details.getByRole('status')).toContainText(`${action}成功`);
}

async function futureLocalTime(page: Page, hours: number) {
  return page.evaluate(value => {
    const date = new Date(Date.now() + value * 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, hours);
}

test('五项自助API权限和DATA=null完成新建、启停、轮换、政策及远期安排后取消', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.scopes = [...selfServiceScopes];
  mock.dataAccess = null;
  await mount(page);
  await page.getByRole('button', { name: '新建密钥', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建密钥', exact: true });
  await createDialog.getByLabel('密钥别名', { exact: true }).fill('自助生命周期密钥');
  await createDialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(createDialog).toHaveCount(0);
  const drawer = page.getByRole('dialog', { name: '自助生命周期密钥', exact: true });
  const details = drawer.getByRole('region', { name: '密钥详情', exact: true });
  await expect(details).toContainText('browser-key-2');
  await expect(details).toContainText('iam:browser-user');
  await confirmOperation(page, '停用');
  await expect(details.getByRole('button', { name: '启用', exact: true })).toBeEnabled();
  await confirmOperation(page, '启用');
  await confirmOperation(page, '轮换');
  await expect(details.locator('.detail-list dt:has-text("活动版本") + dd')).toHaveText('2');
  await details.getByRole('button', { name: '修改销毁政策', exact: true }).click();
  const policyDialog = page.getByRole('dialog', { name: '销毁窗口政策', exact: true });
  await policyDialog.getByRole('spinbutton', { name: '最短提前量（小时）', exact: true }).fill('12');
  await policyDialog.getByRole('spinbutton', { name: '最长提前量（小时）', exact: true }).fill('48');
  await policyDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(policyDialog).toHaveCount(0);
  await expect(details).toContainText('最短提前量：12 小时');
  const dueAt = await futureLocalTime(page, 24);
  await details.getByLabel('销毁时间', { exact: true }).fill(dueAt);
  await confirmOperation(page, '安排销毁');
  await expect(details).toContainText('待销毁');
  await confirmOperation(page, '取消销毁');
  await expect(details.getByRole('button', { name: '停用', exact: true })).toBeEnabled();
  expect(mock.writes).toEqual([
    { method: 'POST', path: '/keys', body: { keyAlias: '自助生命周期密钥', purpose: 'SIGN', algorithm: 'ES256' } },
    { method: 'PATCH', path: '/me/keys/browser-key-2/state', body: { state: 'DISABLED', expectedRowVersion: 1 } },
    { method: 'PATCH', path: '/me/keys/browser-key-2/state', body: { state: 'ACTIVE', expectedRowVersion: 2 } },
    { method: 'POST', path: '/me/keys/browser-key-2/versions', body: { expectedRowVersion: 3 } },
    { method: 'PUT', path: '/me/destruction-policy', body: { minScheduleAheadSeconds: 43200, maxScheduleAheadSeconds: 172800 } },
    { method: 'PUT', path: '/me/keys/browser-key-2/destruction', body: { dueAt: await page.evaluate(value => new Date(value).toISOString(), dueAt), expectedRowVersion: 4 } },
    { method: 'DELETE', path: '/me/keys/browser-key-2/destruction', body: { expectedRowVersion: 5 } }
  ]);
  expect(mock.reads.filter(path => path === '/me/keys/browser-key-2')).toHaveLength(6);
  expect(mock.reads.some(path => path.startsWith('/admin/'))).toBe(false);
  expect(mock.keys.find(key => key.keyRef === 'browser-key-2')).toMatchObject({ state: 'ACTIVE', activeVersion: 2, rowVersion: 6 });
  await expectNoPageOverflow(page);
});

test('治理模式对他人密钥使用旧管理写接口，成功后回读治理详情', async ({ page, mock }) => {
  mock.keys = [{ ...createKey(), ownerPrincipalId: 'iam:other', keyAlias: '治理密钥' }];
  await mount(page, 'keys');
  await page.getByRole('button', { name: '打开治理密钥详情', exact: true }).click();
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await expect(details).toContainText('iam:other');
  await expect(details.getByRole('button', { name: '修改销毁政策', exact: true })).toHaveCount(0);
  await confirmOperation(page, '停用');
  await confirmOperation(page, '启用');
  await confirmOperation(page, '轮换');
  const dueAt = await futureLocalTime(page, 24);
  await details.getByLabel('销毁时间', { exact: true }).fill(dueAt);
  await confirmOperation(page, '安排销毁');
  await confirmOperation(page, '取消销毁');
  expect(mock.writes).toEqual([
    { method: 'PATCH', path: '/keys/browser-key-001/state', body: { state: 'DISABLED', expectedRowVersion: 1 } },
    { method: 'PATCH', path: '/keys/browser-key-001/state', body: { state: 'ACTIVE', expectedRowVersion: 2 } },
    { method: 'POST', path: '/keys/browser-key-001/versions', body: { expectedRowVersion: 3 } },
    { method: 'PUT', path: '/keys/browser-key-001/destruction', body: { dueAt: await page.evaluate(value => new Date(value).toISOString(), dueAt), expectedRowVersion: 4 } },
    { method: 'DELETE', path: '/keys/browser-key-001/destruction', body: { expectedRowVersion: 5 } }
  ]);
  expect(mock.reads.filter(path => path === '/admin/keys/browser-key-001')).toHaveLength(6);
  expect(mock.reads.some(path => path.startsWith('/me/keys'))).toBe(false);
  await expectNoPageOverflow(page);
});

for (const failure of ['before', 'after'] as const) {
  test(`本人轮换${failure === 'before' ? '执行前断网' : '提交后丢失响应'}时同正文同键重试仅轮换一次`, async ({ page, mock }) => {
    mock.pagePermissions = ['kms.page.my-keys'];
    mock.scopes = [...selfServiceScopes];
    mock.dataAccess = null;
    mock.rotationNetworkFailure = failure;
    await mount(page);
    await page.getByRole('button', { name: '打开订单签名密钥详情', exact: true }).click();
    const details = page.getByRole('region', { name: '密钥详情', exact: true });
    await details.getByRole('button', { name: '轮换', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
    await dialog.getByRole('button', { name: '轮换', exact: true }).click();
    await expect(dialog).toContainText('Failed to fetch');
    expect(mock.keys[0]!.activeVersion).toBe(failure === 'before' ? 1 : 2);
    await dialog.getByRole('button', { name: '轮换', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(details.locator('.detail-list dt:has-text("活动版本") + dd')).toHaveText('2');
    expect(mock.writes).toEqual([
      { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 1 } },
      { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 1 } }
    ]);
    expect(mock.idempotencyKeys[0]).toBeTruthy();
    expect(mock.idempotencyKeys[1]).toBe(mock.idempotencyKeys[0]);
    expect(mock.keys[0]).toMatchObject({ activeVersion: 2, rowVersion: 2 });
  });
}

for (const mode of ['self', 'governance'] as const) {
  for (const action of ['轮换', '安排销毁'] as const) {
    test(`${mode}模式${action}权限被撤销时不回退写接口，恢复授权后沿原入口重试`, async ({ page, mock }) => {
      mock.dataAccess = mode === 'self' ? null : 'all';
      await mount(page, mode === 'self' ? 'my-keys' : 'keys');
      await page.getByRole('button', { name: '打开订单签名密钥详情', exact: true }).click();
      const details = page.getByRole('region', { name: '密钥详情', exact: true });
      if (action === '安排销毁') await details.getByLabel('销毁时间', { exact: true }).fill(await futureLocalTime(page, 24));
      await details.getByRole('button', { name: action, exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      const scope = action === '轮换' ? 'kms.key.manage' : 'kms.key.destroy';
      mock.scopes = mock.scopes.filter(item => item !== scope);
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(dialog).toContainText('没有执行该操作的权限');
      expect(mock.writes).toHaveLength(1);
      expect(mock.writes[0]!.path).toBe(`${mode === 'self' ? '/me' : ''}/keys/browser-key-001/${action === '轮换' ? 'versions' : 'destruction'}`);
      expect(mock.keys[0]).toMatchObject({ state: 'ACTIVE', activeVersion: 1, rowVersion: 1 });
      mock.scopes.push(scope);
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(details.getByRole('status')).toContainText(`${action}成功`);
      expect(mock.writes[1]).toEqual(mock.writes[0]);
      expect(mock.idempotencyKeys[1]).toBe(mock.idempotencyKeys[0]);
    });
  }
}

test('DATA=null拒绝四种旧管理写和已知他人密钥的四种本人写，目标与任务不改变', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.scopes = [...selfServiceScopes];
  mock.dataAccess = null;
  const other = { ...createKey(), ownerPrincipalId: 'iam:other', keyRef: 'known-other-key', keyAlias: '他人密钥' };
  mock.keys.push(other);
  await mount(page);
  await expect(page.getByRole('table')).not.toContainText('他人密钥');
  const before = { ...other };
  const results = await page.evaluate(async () => {
    const commands = [
      { method: 'PATCH', suffix: 'state', body: { state: 'DISABLED', expectedRowVersion: 1 } },
      { method: 'POST', suffix: 'versions', body: { expectedRowVersion: 1 } },
      { method: 'PUT', suffix: 'destruction', body: { dueAt: '2030-01-02T10:00:00.000Z', expectedRowVersion: 1 } },
      { method: 'DELETE', suffix: 'destruction', body: { expectedRowVersion: 1 } }
    ];
    const statuses = [];
    for (const prefix of ['', '/me']) {
      for (const [index, command] of commands.entries()) {
        const response = await fetch(`/api/kms${prefix}/keys/${prefix ? 'known-other-key' : 'browser-key-001'}/${command.suffix}`, {
          method: command.method,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token', 'Idempotency-Key': `denied-${prefix}-${index}` },
          body: JSON.stringify(command.body)
        });
        statuses.push(response.status);
      }
    }
    return statuses;
  });
  expect(results).toEqual([403, 403, 403, 403, 404, 404, 404, 404]);
  expect(other).toEqual(before);
  expect(mock.keys[0]).toMatchObject({ state: 'ACTIVE', activeVersion: 1, rowVersion: 1 });
  expect(mock.destructionJobs).toEqual([]);
});
