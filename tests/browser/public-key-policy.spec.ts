import { expect } from '@playwright/test';
import { createKey, expectNoPageOverflow, mount, selfServiceScopes, test } from './fixtures';

for (const state of ['ACTIVE', 'DISABLED']) {
  test(`五项本人API和DATA=null直接读取${state}密钥全部公钥版本，零使用策略且不绕路`, async ({ page, mock }, testInfo) => {
    mock.pagePermissions = ['kms.page.my-keys'];
    mock.scopes = [...selfServiceScopes];
    mock.dataAccess = null;
    mock.keys = [{ ...createKey(state), activeVersion: 2 }];
    mock.publicKeys = [
      { keyRef: 'browser-key-001', version: 1, algorithm: 'ES256', state: 'RETIRED', publicKey: 'HistoricalPublicKey'.repeat(12) },
      { keyRef: 'browser-key-001', version: 2, algorithm: 'ES256', state: 'ACTIVE', publicKey: 'CurrentPublicKey'.repeat(12) }
    ];
    await mount(page);
    await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
    const publicKeys = page.getByRole('region', { name: '公钥', exact: true });
    await expect(publicKeys.getByRole('textbox', { name: '公钥值', exact: true })).toHaveValue(mock.publicKeys[1]!.publicKey);
    await publicKeys.getByRole('button', { name: '公钥版本', exact: true }).click();
    await publicKeys.getByRole('option', { name: '版本 1 · 已退役', exact: true }).click();
    await expect(publicKeys.getByRole('textbox', { name: '公钥值', exact: true })).toHaveValue(mock.publicKeys[0]!.publicKey);
    expect(mock.reads).toContain('/me/keys/browser-key-001/public-keys');
    expect(mock.reads.some(path => /^\/keys\/.*\/public-keys?/.test(path))).toBe(false);
    expect(mock.reads.some(path => path.includes('/policies') || path.startsWith('/admin/'))).toBe(false);
    expect(mock.legacyPublicKeyPolicyVersions).toEqual({});
    expect(mock.writes).toEqual([]);
    await expect(publicKeys.getByRole('link', { name: '配置公钥策略', exact: true })).toHaveCount(0);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`self-public-key-${state}.png`), fullPage: true });
  });
}

for (const status of [403, 503]) {
  test(`本人公钥${status}拒绝可重试且不跳旧接口或创建策略`, async ({ page, mock }) => {
    mock.publicKeyStatus = status;
    await mount(page);
    await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
    const publicKeys = page.getByRole('region', { name: '公钥', exact: true });
    const error = publicKeys.getByRole('alert');
    await expect(error).toContainText(status === 403 ? '公钥读取被拒绝，请确认当前账号仍有读取本人公钥的权限' : 'HTTP 503');
    await expect(error).not.toContainText('策略');
    await expect(publicKeys.getByRole('link', { name: '配置公钥策略', exact: true })).toHaveCount(0);
    mock.publicKeyStatus = 200;
    await publicKeys.getByRole('button', { name: '重试', exact: true }).click();
    await expect(publicKeys.getByRole('textbox', { name: '公钥值', exact: true })).toHaveValue(mock.publicKeys[0]!.publicKey);
    expect(mock.reads.filter(path => path === '/me/keys/browser-key-001/public-keys')).toHaveLength(2);
    expect(mock.reads.some(path => /^\/keys\/.*\/public-keys?/.test(path) || path.includes('/policies'))).toBe(false);
    expect(mock.writes).toEqual([]);
    await expectNoPageOverflow(page);
  });
}

test('SERVICE主体不能使用本人公钥页面入口，后端仍返回403', async ({ page, mock }) => {
  mock.subjectType = 'SERVICE';
  mock.principalId = 'aksk:browser-service';
  mock.keys[0]!.ownerPrincipalId = mock.principalId;
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const publicKeys = page.getByRole('region', { name: '公钥', exact: true });
  await expect(publicKeys).toContainText('本人公钥查看仅供人员身份使用');
  expect(mock.reads.some(path => path.endsWith('/public-keys'))).toBe(false);
  const status = await page.evaluate(async () => (await fetch('/api/kms/me/keys/browser-key-001/public-keys', {
    headers: { Authorization: 'Bearer browser-fixture-token' }
  })).status);
  expect(status).toBe(403);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

test('缺公钥API时不请求公钥，服务端不因本人归属放行', async ({ page, mock }) => {
  mock.scopes = ['kms.me.read', 'kms.key.read'];
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '公钥', exact: true })).toContainText('没有读取公钥的权限');
  expect(mock.reads.some(path => path.includes('/public-key'))).toBe(false);
  const status = await page.evaluate(async () => (await fetch('/api/kms/me/keys/browser-key-001/public-keys', {
    headers: { Authorization: 'Bearer browser-fixture-token' }
  })).status);
  expect(status).toBe(403);
  expect(mock.writes).toEqual([]);
});

test('本人公钥保持归属和状态约束，旧密码服务接口仍需要使用策略', async ({ page, mock }) => {
  mock.keys.push({ ...createKey(), keyRef: 'other-key', ownerPrincipalId: 'iam:other' },
    { ...createKey(), keyRef: 'aes-key', algorithm: 'AES_256_GCM', purpose: 'ENCRYPT' },
    { ...createKey('PENDING_DESTRUCTION'), keyRef: 'pending-key' },
    { ...createKey('DESTROYED'), keyRef: 'destroyed-key' });
  await mount(page);
  const statuses = await page.evaluate(async () => {
    const paths = [
      '/me/keys/other-key/public-keys', '/me/keys/unknown-key/public-keys',
      '/me/keys/aes-key/public-keys', '/me/keys/pending-key/public-keys', '/me/keys/destroyed-key/public-keys',
      '/keys/browser-key-001/public-keys', '/me/keys/browser-key-001/public-keys'
    ];
    const results = [];
    for (const path of paths) results.push((await fetch(`/api/kms${path}`, {
      headers: { Authorization: 'Bearer browser-fixture-token' }
    })).status);
    return results;
  });
  expect(statuses).toEqual([404, 404, 409, 409, 409, 403, 200]);
  mock.legacyPublicKeyPolicyVersions['browser-key-001'] = 'all';
  const granted = await page.evaluate(async () => (await fetch('/api/kms/keys/browser-key-001/public-keys', {
    headers: { Authorization: 'Bearer browser-fixture-token' }
  })).status);
  expect(granted).toBe(200);
  expect(mock.writes).toEqual([]);
});

for (const state of ['PENDING_DESTRUCTION', 'DESTROYED']) {
  test(`${state}密钥详情不再发公钥请求`, async ({ page, mock }) => {
    mock.keys = [createKey(state)];
    await mount(page);
    await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
    const publicKeys = page.getByRole('region', { name: '公钥', exact: true });
    await expect(publicKeys).toContainText('不再提供公钥');
    await expect(publicKeys.getByRole('textbox', { name: '公钥值', exact: true })).toHaveCount(0);
    expect(mock.reads.some(path => path.includes('/public-key'))).toBe(false);
    expect(mock.writes).toEqual([]);
    await expectNoPageOverflow(page);
  });
}
