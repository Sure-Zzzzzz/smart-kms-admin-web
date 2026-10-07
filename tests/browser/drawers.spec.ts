import { expect } from '@playwright/test';
import { createKey, expectNoPageOverflow, mount, test } from './fixtures';

test('128字符主体标识在撤销策略确认中完整换行且不超出视口', async ({ page, mock }, testInfo) => {
  const principalId = `aksk:${'W'.repeat(123)}`;
  await page.route('**/api/kms/admin/policies*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ policyId: 'long-principal-policy', keyRef: 'browser-key-001', keyAlias: '订单签名密钥', ownerPrincipalId: 'iam:browser-user', principalId, keyVersion: null, operation: 'SIGN', expiresAt: null, rowVersion: 1, createdAt: '2026-01-01T00:00:00Z' }], page: 1, size: 100, total: 1 })
    });
  });
  await mount(page, 'policies');
  await page.getByRole('row').filter({ hasText: '订单签名密钥' }).getByRole('button', { name: '撤销策略', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '撤销密钥策略', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('p')).toContainText(principalId);
  expect(await dialog.locator('p').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('long-principal-confirmation.png'), fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toEqual([]);
});

for (const scenario of [
  { entry: '新建密钥', dialog: '新建密钥', first: '密钥别名', last: '创建' },
  { entry: '销毁政策', dialog: '销毁窗口政策', first: '最短提前量（小时）', last: '保存' }
]) {
  test(`${scenario.entry} 表单的Tab和Shift+Tab保留在浮层，关闭恢复来源`, async ({ page, mock }) => {
    await mount(page);
    const entry = page.getByRole('button', { name: scenario.entry, exact: true });
    await entry.click();
    const dialog = page.getByRole('dialog', { name: scenario.dialog, exact: true });
    const first = dialog.getByLabel(scenario.first, { exact: true });
    if (scenario.entry === '新建密钥') await first.fill('键盘验收密钥');
    const last = dialog.getByRole('button', { name: scenario.last, exact: true });
    await expect(last).toBeEnabled();
    await dialog.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    expect(mock.writes).toEqual([]);
  });
}

test('抽屉和嵌套确认只保留顶层焦点，背景滚动在最后关闭后恢复', async ({ page, mock }) => {
  mock.keys = Array.from({ length: 100 }, (_, index) => ({ ...createKey(), keyRef: `scroll-key-${index}`, keyAlias: `滚动密钥 ${index}` }));
  await mount(page);
  const original = await page.evaluate(() => [document.documentElement, document.body].map(element =>
    ['overflow', 'overflow-x', 'overflow-y', 'padding-right'].map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)])));
  const entry = page.getByRole('button', { name: '查看滚动密钥 0详情', exact: true });
  await entry.click();
  const drawer = page.getByRole('dialog', { name: '滚动密钥 0', exact: true });
  const rotate = drawer.getByRole('button', { name: '轮换', exact: true });
  await expect(rotate).toBeEnabled();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');

  await rotate.click();
  const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  const confirm = dialog.getByRole('button', { name: '轮换', exact: true });
  await dialog.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await entry.evaluate(element => (element as HTMLElement).focus());
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(rotate).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(entry).toBeFocused();
  expect(await page.evaluate(() => [document.documentElement, document.body].map(element =>
    ['overflow', 'overflow-x', 'overflow-y', 'padding-right'].map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)])))).toEqual(original);
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  expect(mock.writes).toEqual([]);
});

test('有政策浮层时卸载子应用会恢复已有滚动样式和priority', async ({ page, mock }) => {
  await mount(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('overflow-y', 'scroll', 'important');
    document.body.style.setProperty('padding-right', '7px', 'important');
  });
  const original = await page.evaluate(() => [document.documentElement, document.body].map(element =>
    ['overflow', 'overflow-x', 'overflow-y', 'padding-right'].map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)])));
  await page.getByRole('button', { name: '销毁政策', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '销毁窗口政策', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  await page.evaluate(async () => (window as unknown as { __kmsFixture: { unmount(): Promise<unknown> } }).__kmsFixture.unmount());
  await expect(page.locator('.kms-admin-app')).toHaveCount(0);
  expect(await page.evaluate(() => [document.documentElement, document.body].map(element =>
    ['overflow', 'overflow-x', 'overflow-y', 'padding-right'].map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)])))).toEqual(original);
  expect(mock.writes).toEqual([]);
});

test('嵌套确认冻结下层抽屉滚动，顶层可滚动且关闭后恢复抽屉', async ({ page, mock }) => {
  await mount(page);
  await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '订单签名密钥', exact: true });
  const content = drawer.locator('.drawer-content');
  await content.evaluate(element => {
    const scroller = element as HTMLElement;
    scroller.style.height = '180px';
    scroller.style.flex = 'none';
    scroller.style.setProperty('overflow-y', 'auto', 'important');
  });
  await drawer.getByRole('button', { name: '轮换', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => content.evaluate(element => (element as HTMLElement).style.overflow)).toBe('hidden');
  const before = await content.evaluate(element => element.scrollTop);
  await dialog.evaluate(element => {
    const panel = element as HTMLElement;
    panel.style.maxHeight = '120px';
    panel.style.overflowY = 'auto';
    panel.scrollTop = 0;
  });
  await expect(dialog).toHaveCSS('overflow-y', 'auto');
  expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.hover({ position: { x: 30, y: 40 } });
  await page.mouse.wheel(0, 400);
  await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await content.evaluate(element => element.scrollTop)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await content.evaluate(element => ({
    value: (element as HTMLElement).style.getPropertyValue('overflow-y'),
    priority: (element as HTMLElement).style.getPropertyPriority('overflow-y'),
    top: element.scrollTop
  }))).toEqual({ value: 'auto', priority: 'important', top: before });
  await content.evaluate(element => { element.scrollTop = 0; });
  const contentBounds = await content.boundingBox();
  await page.mouse.move(contentBounds!.x + contentBounds!.width / 2, contentBounds!.y + 70);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  expect(mock.writes).toEqual([]);
});

for (const path of ['my-keys', 'keys']) {
  test(`${path} 文字详情打开抽屉，关闭和 Esc 恢复来源焦点，桌面遮罩可关闭`, async ({ page, mock }, testInfo) => {
    await mount(page, path);
    const entry = page.getByRole('button', { name: '查看订单签名密钥详情', exact: true });
    await expect(entry).toHaveText('查看详情');
    await entry.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: '订单签名密钥', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer).toBeFocused();
    await expect(drawer.getByRole('region', { name: '密钥详情', exact: true })).toContainText('browser-key-001');
    expect(await drawer.evaluate(element => Boolean(element.closest('#micro-app [data-qiankun]')))).toBe(true);
    const bounds = await drawer.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBe(page.viewportSize()!.width);
    expect(bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('key-details-drawer.png'), fullPage: true });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(entry).toBeFocused();

    await entry.click();
    await expect(drawer).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(entry).toBeFocused();

    if (bounds!.x > 0) {
      await entry.click();
      await expect(drawer).toBeVisible();
      await page.locator('.drawer-backdrop').click({ position: { x: 5, y: 5 } });
      await expect(drawer).toHaveCount(0);
      await expect(entry).toBeFocused();
    }
    expect(mock.writes).toEqual([]);
  });

  test(`${path} 128字符无空格别名在抽屉与生命周期确认中完整换行`, async ({ page, mock }, testInfo) => {
    const alias = 'W'.repeat(128);
    mock.keys[0]!.keyAlias = alias;
    await mount(page, path);
    await page.getByRole('button', { name: `查看${alias}详情`, exact: true }).click();
    const drawer = page.getByRole('dialog', { name: alias, exact: true });
    await expect(drawer).toBeVisible();
    const title = drawer.locator('.drawer-header h2');
    await expect(title).toHaveText(alias);
    expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await drawer.getByRole('button', { name: '轮换', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('p')).toContainText(alias);
    expect(await dialog.locator('p').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const description = await dialog.locator('p').boundingBox();
    const footer = await dialog.locator('footer').boundingBox();
    expect(description!.y + description!.height).toBeLessThanOrEqual(footer!.y);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('long-key-alias-confirmation.png'), fullPage: true });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(drawer).toBeVisible();
    expect(mock.writes).toEqual([]);
  });
}

test('详情内生命周期确认 Esc 只关闭确认层，焦点返回操作，第二次 Esc 才关闭抽屉', async ({ page, mock }) => {
  await mount(page);
  const entry = page.getByRole('button', { name: '查看订单签名密钥详情', exact: true });
  await entry.click();
  const drawer = page.getByRole('dialog', { name: '订单签名密钥', exact: true });
  const rotate = drawer.getByRole('button', { name: '轮换', exact: true });
  await expect(rotate).toBeEnabled();
  await rotate.click();
  const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
  await expect(dialog).toBeFocused();
  await expect(drawer).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(rotate).toBeFocused();
  expect(mock.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test('详情内销毁政策 Esc、遮罩和保存只关闭政策层并恢复焦点', async ({ page, mock }, testInfo) => {
  await mount(page);
  const entry = page.getByRole('button', { name: '查看订单签名密钥详情', exact: true });
  await entry.click();
  const drawer = page.getByRole('dialog', { name: '订单签名密钥', exact: true });
  const editPolicy = drawer.getByRole('button', { name: '修改销毁政策', exact: true });
  await editPolicy.click();
  const policyDialog = page.getByRole('dialog', { name: '销毁窗口政策', exact: true });
  await expect(policyDialog).toBeFocused();
  await expect(drawer).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(policyDialog).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(editPolicy).toBeFocused();
  expect(mock.writes).toEqual([]);

  await editPolicy.click();
  await expect(policyDialog).toBeFocused();
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(policyDialog).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(editPolicy).toBeFocused();
  expect(mock.writes).toEqual([]);

  await editPolicy.click();
  await policyDialog.getByRole('spinbutton', { name: '最短提前量（小时）', exact: true }).fill('24');
  await policyDialog.getByRole('spinbutton', { name: '最长提前量（小时）', exact: true }).fill('48');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('destruction-policy-over-drawer.png'), fullPage: true });
  await policyDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(policyDialog).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(editPolicy).toBeFocused();
  await expect(drawer.getByRole('region', { name: '归属人销毁政策', exact: true })).toContainText('最短提前量：24 小时');
  expect(mock.writes).toEqual([{ method: 'PUT', path: '/me/destruction-policy', body: { minScheduleAheadSeconds: 86400, maxScheduleAheadSeconds: 172800 } }]);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test('生命周期提交中 Esc 和确认遮罩保留两层，完成后仍保留详情且只写一次', async ({ page, mock }) => {
  let releaseRequest = () => {};
  const released = new Promise<void>(resolve => { releaseRequest = resolve; });
  await page.route('**/api/kms/me/keys/browser-key-001/versions', async route => {
    await released;
    await route.fallback();
  });
  try {
    await mount(page);
    await page.getByRole('button', { name: '查看订单签名密钥详情', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '订单签名密钥', exact: true });
    await drawer.getByRole('button', { name: '轮换', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '轮换密钥', exact: true });
    await dialog.getByRole('button', { name: '轮换', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /正在处理/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(drawer).toBeVisible();
    await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeVisible();
    await expect(drawer).toBeVisible();
    releaseRequest();
    await expect(dialog).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('region', { name: '密钥详情', exact: true }).locator('.kms-facts > div').filter({ has: page.getByText('活动版本', { exact: true }) })).toContainText('2');
    expect(mock.writes).toEqual([{ method: 'POST', path: '/me/keys/browser-key-001/versions', body: { expectedRowVersion: 1 } }]);
    await expectNoPageOverflow(page);
  } finally {
    releaseRequest();
  }
});
