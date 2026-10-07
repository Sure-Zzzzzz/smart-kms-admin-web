import { expect, type Page } from '@playwright/test';
import { createKey, expectNoPageOverflow, mount, selfServiceScopes, test } from './fixtures';

async function confirmOperation(page: Page, action: string, title: string) {
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await details.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => Boolean(element.closest('#micro-app [data-qiankun]')))).toBe(true);
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function futureLocalTime(page: Page, hours: number) {
  return page.evaluate(value => {
    const date = new Date(Date.now() + value * 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, hours);
}

test('仅我的密钥页面完成详情、启停、轮换、政策关联和安排后取消销毁', async ({ page, mock }, testInfo) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.scopes = [...selfServiceScopes];
  mock.dataAccess = null;
  await mount(page);
  const entry = page.getByRole('button', { name: '查看订单签名密钥详情', exact: true });
  await entry.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await expect(details).toContainText('browser-key-001');
  await expect(details).toContainText('iam:browser-user');
  await expect(details.getByRole('button', { name: '停用', exact: true })).toBeEnabled();
  await expect(details.getByRole('region', { name: '公钥', exact: true }).getByRole('textbox', { name: '公钥值', exact: true })).toHaveValue(mock.publicKeys[0]!.publicKey);

  await confirmOperation(page, '停用', '停用密钥');
  await expect(details.getByRole('button', { name: '启用', exact: true })).toBeEnabled();
  await confirmOperation(page, '启用', '启用密钥');
  await expect(details.getByRole('button', { name: '轮换', exact: true })).toBeEnabled();
  await confirmOperation(page, '轮换', '轮换密钥');
  await expect(details.locator('.kms-facts > div').filter({ has: page.getByText('活动版本', { exact: true }) })).toContainText('2');
  await expect(details.getByRole('region', { name: '公钥', exact: true }).getByRole('button', { name: '公钥版本', exact: true })).toContainText('版本 2');

  const policy = details.getByRole('region', { name: '归属人销毁政策', exact: true });
  await expect(policy).toContainText('名下的全部密钥');
  await policy.getByRole('button', { name: '修改销毁政策', exact: true }).click();
  const policyDialog = page.getByRole('dialog', { name: '销毁窗口政策', exact: true });
  await policyDialog.getByRole('spinbutton', { name: '最短提前量（小时）', exact: true }).fill('0.5');
  await policyDialog.getByRole('spinbutton', { name: '最长提前量（小时）', exact: true }).fill('1.5');
  await policyDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(policyDialog).toHaveCount(0);
  await expect(policy).toContainText('最短提前量：0.5 小时');
  await expect(policy).toContainText('最长提前量：1.5 小时');

  await policy.getByLabel('销毁时间', { exact: true }).fill(await futureLocalTime(page, 0.25));
  await policy.getByRole('button', { name: '安排销毁', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('符合该归属人的销毁窗口');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(mock.writes.filter(write => write.path.endsWith('/destruction'))).toEqual([]);

  const dueAt = await futureLocalTime(page, 1);
  await policy.getByLabel('销毁时间', { exact: true }).fill(dueAt);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('self-service-policy-details.png'), fullPage: true });
  await confirmOperation(page, '安排销毁', '安排销毁');
  await expect(details).toContainText('PENDING_DESTRUCTION');
  await expect(details.getByRole('region', { name: '公钥', exact: true }).getByRole('textbox', { name: '公钥值', exact: true })).toHaveCount(0);
  await expect(details.getByRole('region', { name: '销毁进度', exact: true })).toContainText('等待执行');
  await confirmOperation(page, '取消销毁', '取消销毁任务');
  await expect(details.getByRole('button', { name: '停用', exact: true })).toBeEnabled();

  expect(mock.writes).toEqual([
    { method: 'PATCH', path: '/me/keys/browser-key-001/state', body: { state: 'DISABLED', expectedRowVersion: 1 } },
    { method: 'PATCH', path: '/me/keys/browser-key-001/state', body: { state: 'ACTIVE', expectedRowVersion: 2 } },
    { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 3 } },
    { method: 'PUT', path: '/me/destruction-policy', body: { minScheduleAheadSeconds: 1800, maxScheduleAheadSeconds: 5400 } },
    { method: 'PUT', path: '/me/keys/browser-key-001/destruction', body: { dueAt: await page.evaluate(value => new Date(value).toISOString(), dueAt), expectedRowVersion: 4 } },
    { method: 'DELETE', path: '/me/keys/browser-key-001/destruction', body: { expectedRowVersion: 5 } }
  ]);
  expect(mock.reads).toContain('/me/keys/browser-key-001');
  expect(mock.reads.some(path => path.startsWith('/admin/'))).toBe(false);
  const commandKeys = mock.idempotencyKeys.filter(Boolean);
  expect(commandKeys).toHaveLength(5);
  expect(new Set(commandKeys).size).toBe(5);
  await expect(policy).toContainText('最短提前量：0.5 小时');
  await expect(details.getByRole('region', { name: '公钥', exact: true }).getByRole('button', { name: '公钥版本', exact: true })).toContainText('版本 2');
  await expect(details.getByRole('alert')).toHaveCount(0);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('completed-key-details.png'), fullPage: true });
  await policy.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('completed-policy-in-drawer.png'), fullPage: true });
  await details.getByRole('region', { name: '公钥', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('completed-public-key-in-drawer.png'), fullPage: true });
});

test('我的密钥只读主体能读详情，缺少管理和公钥权限不发对应请求', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.scopes = ['kms.me.read', 'kms.key.read'];
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await expect(details).toContainText('browser-key-001');
  await expect(details.getByRole('button', { name: /^(停用|启用|轮换|安排销毁|取消销毁|修改销毁政策)$/ })).toHaveCount(0);
  await expect(details.getByRole('region', { name: '公钥', exact: true })).toContainText('没有读取公钥的权限');
  await expect(page.getByRole('button', { name: '新建密钥', exact: true })).toHaveCount(0);
  expect(mock.reads.some(path => /public-key|destruction-policy/.test(path))).toBe(false);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

test('详情数据权限拒绝不泄露密钥，重新读取可恢复', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.keyDetailStatus = 403;
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await expect(details.getByRole('alert')).toContainText('没有执行该操作的权限');
  await expect(details).not.toContainText('browser-key-001');
  await expect(details.getByRole('button', { name: '轮换', exact: true })).toHaveCount(0);
  mock.keyDetailStatus = 200;
  await details.getByRole('button', { name: '重新读取详情', exact: true }).click();
  await expect(details).toContainText('browser-key-001');
  expect(await page.locator('body').innerText()).not.toMatch(/Bearer|browser-fixture-token/);
  expect(mock.writes).toEqual([]);
});

test('ES256 公钥权限拒绝可重试，历史版本键盘可选且复制不写业务', async ({ page, context, mock }, testInfo) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.scopes = ['kms.me.read', 'kms.key.read', 'kms.read-public-key'];
  mock.keys = [{ ...createKey(), activeVersion: 2 }];
  mock.publicKeyStatus = 403;
  mock.publicKeys = [
    { keyRef: 'browser-key-001', version: 1, algorithm: 'ES256', state: 'RETIRED', publicKey: 'HistoricalBrowserPublicKey'.repeat(12) },
    { keyRef: 'browser-key-001', version: 2, algorithm: 'ES256', state: 'ACTIVE', publicKey: 'CurrentBrowserPublicKey'.repeat(12) }
  ];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const publicKey = page.getByRole('region', { name: '公钥', exact: true });
  await expect(publicKey.getByRole('alert')).toContainText('公钥读取被拒绝，请确认当前账号仍有读取本人公钥的权限');
  await expect(publicKey.getByRole('alert')).not.toContainText('策略');
  await expect(publicKey.getByRole('link', { name: '配置公钥策略', exact: true })).toHaveCount(0);
  await expect(publicKey.getByRole('textbox', { name: '公钥值', exact: true })).toHaveCount(0);
  mock.publicKeyStatus = 200;
  await publicKey.getByRole('button', { name: '重试', exact: true }).click();
  const value = publicKey.getByRole('textbox', { name: '公钥值', exact: true });
  await expect(value).toHaveValue(mock.publicKeys[1]!.publicKey);
  const selector = publicKey.getByRole('button', { name: '公钥版本', exact: true });
  await selector.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(selector).toContainText('版本 1');
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  await expect(value).toHaveValue(mock.publicKeys[0]!.publicKey);
  await publicKey.getByRole('button', { name: '复制公钥', exact: true }).click();
  await expect(publicKey.getByRole('status')).toContainText('公钥已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mock.publicKeys[0]!.publicKey);
  expect(mock.reads.filter(path => path.endsWith('/public-keys'))).toHaveLength(2);
  expect(mock.reads.filter(path => path.endsWith('/public-keys'))).toEqual([
    '/me/keys/browser-key-001/public-keys', '/me/keys/browser-key-001/public-keys'
  ]);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
  const bounds = await publicKey.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('historical-public-key.png'), fullPage: true });
});

test('AES 对称密钥没有公钥查看入口或公钥请求', async ({ page, mock }) => {
  mock.keys = [{ ...createKey(), purpose: 'ENCRYPT', algorithm: 'AES_256_GCM' }];
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const publicKey = page.getByRole('region', { name: '公钥', exact: true });
  await expect(publicKey).toContainText('没有公钥');
  await expect(publicKey.getByRole('button', { name: '公钥版本', exact: true })).toHaveCount(0);
  await expect(publicKey.getByRole('textbox', { name: '公钥值', exact: true })).toHaveCount(0);
  expect(mock.reads.some(path => path.includes('/public-key'))).toBe(false);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

test('轮换服务失败保留确认，重试沿用幂等键并更新详情版本', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.rotationStatus = 503;
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await details.getByRole('button', { name: '轮换', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
  await dialog.getByRole('button', { name: '轮换', exact: true }).click();
  await expect(dialog).toContainText('HTTP 503');
  mock.rotationStatus = 200;
  await dialog.getByRole('button', { name: '轮换', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details.locator('.kms-facts > div').filter({ has: page.getByText('活动版本', { exact: true }) })).toContainText('2');
  expect(mock.writes).toEqual([
    { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 1 } },
    { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 1 } }
  ]);
  expect(mock.idempotencyKeys[0]).toBeTruthy();
  expect(mock.idempotencyKeys[1]).toBe(mock.idempotencyKeys[0]);
  await expectNoPageOverflow(page);
});

test('生命周期并发冲突清空旧详情，重新读取和确认使用最新资源版本', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const details = page.getByRole('region', { name: '密钥详情', exact: true });
  await expect(details.getByRole('button', { name: '轮换', exact: true })).toBeEnabled();
  mock.keys[0]!.rowVersion = 9;
  await confirmOperation(page, '轮换', '轮换密钥');
  await expect(details.getByRole('alert')).toContainText('请核对重新读取的详情后重新确认操作');
  expect(mock.writes).toHaveLength(1);
  expect(mock.keys[0]!.activeVersion).toBe(1);
  await expect(details.getByRole('button', { name: '重新读取详情', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: '轮换', exact: true })).toBeEnabled();
  await confirmOperation(page, '轮换', '轮换密钥');
  await expect(details.locator('.kms-facts > div').filter({ has: page.getByText('活动版本', { exact: true }) })).toContainText('2');
  expect(mock.writes).toEqual([
    { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 1 } },
    { method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 9 } }
  ]);
  expect(mock.idempotencyKeys[0]).toBeTruthy();
  expect(mock.idempotencyKeys[1]).not.toBe(mock.idempotencyKeys[0]);
  expect(mock.reads.filter(path => path === '/me/keys/browser-key-001')).toHaveLength(3);
  await expectNoPageOverflow(page);
});
