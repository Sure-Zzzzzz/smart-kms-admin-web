import { expect } from '@playwright/test';
import { createDestructionJob, createKey, expectNoPageOverflow, mount, test } from './fixtures';

test('生产构建经样式隔离宿主挂载，三主题与自定义完整调色板贯通', async ({ page, mock }, testInfo) => {
  await mount(page);
  await expect(page.getByRole('heading', { name: '我的密钥', exact: true })).toBeVisible();
  await expect(page.locator('.kms-standalone-header')).toHaveCount(0);
  await expect(page.getByText('订单签名密钥', { exact: true })).toBeVisible();
  for (const mode of ['light', 'dark', 'custom'] as const) {
    await page.evaluate(value => {
      const host = (window as unknown as { __kmsFixture: { setTheme(mode: string): void } }).__kmsFixture;
      host.setTheme(value);
    }, mode);
    await expect(page.locator('.kms-admin-app')).toHaveAttribute('data-iam-theme', mode);
    const colors = await page.locator('.kms-admin-app').evaluate(root => {
      const host = (window as unknown as { __kmsFixture: { customTokens: Record<string, string>; tokenKeys: string[] } }).__kmsFixture;
      const style = getComputedStyle(root);
      return {
        background: style.backgroundColor,
        canvas: style.getPropertyValue('--iam-color-canvas').trim(),
        custom: host.tokenKeys.map(key => ({
          key,
          actual: style.getPropertyValue(`--iam-color-${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`).trim().toUpperCase(),
          expected: host.customTokens[key].toUpperCase()
        }))
      };
    });
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.canvas).toMatch(/^#[0-9a-f]{6}$/i);
    if (mode === 'custom') for (const token of colors.custom) expect(token.actual, token.key).toBe(token.expected);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${mode}.png`), fullPage: true });
  }
  expect(mock.writes).toEqual([]);
  await page.evaluate(async () => {
    await (window as unknown as { __kmsFixture: { unmount(): Promise<unknown> } }).__kmsFixture.unmount();
  });
  await expect(page.locator('.kms-admin-app')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __kmsFixture: { subscriberCount(): number } }).__kmsFixture.subscriberCount())).toBe(0);
});

test('FormSelect 支持键盘选择、Esc、Tab、外点和滚动关闭', async ({ page }) => {
  await mount(page);
  const selector = page.getByRole('button', { name: '按状态筛选', exact: true });
  await selector.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: '按状态筛选' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(selector).toHaveText('活动');
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  expect(await selector.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('2px');
  await selector.click();
  await page.keyboard.press('Escape');
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  await selector.click();
  await page.keyboard.press('Tab');
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  await selector.click();
  await page.locator('#fixture-header').click();
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  await selector.click();
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  await expectNoPageOverflow(page);
});

test('创建密钥弹窗留在子应用，取消不写入，确认发送正确用途算法', async ({ page, mock }) => {
  await mount(page);
  await page.getByRole('button', { name: '新建密钥', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建密钥', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => Boolean(element.closest('#micro-app [data-qiankun]')))).toBe(true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  await page.getByRole('textbox', { name: '按别名筛选', exact: true }).fill('订单');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByRole('button', { name: '新建密钥', exact: true }).click();
  await dialog.getByLabel('密钥别名', { exact: true }).fill('浏览器加密密钥');
  await dialog.getByRole('button', { name: '用途', exact: true }).click();
  await dialog.getByRole('option', { name: /加解密/ }).click();
  await expect(dialog.getByRole('button', { name: '算法', exact: true })).toHaveText('AES-256-GCM（对称）');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '按别名筛选', exact: true })).toHaveValue('');
  await expect(page.getByRole('table').getByText('浏览器加密密钥', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '密钥详情', exact: true })).toContainText('browser-key-2');
  expect(mock.writes).toEqual([{ method: 'POST', path: '/keys', body: { keyAlias: '浏览器加密密钥', purpose: 'ENCRYPT', algorithm: 'AES_256_GCM' } }]);
});

test('销毁政策回读半小时，原生表单可提交一点五小时上限', async ({ page, mock }) => {
  mock.myDestructionPolicy = { exists: true, minScheduleAheadSeconds: 1800, maxScheduleAheadSeconds: null };
  await mount(page);
  await page.getByRole('button', { name: '销毁政策', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '销毁窗口政策', exact: true });
  const minimum = dialog.getByRole('spinbutton', { name: '最短提前量（小时）', exact: true });
  const maximum = dialog.getByRole('spinbutton', { name: '最长提前量（小时）', exact: true });
  await expect(minimum).toHaveValue('0.5');
  await maximum.fill('1.5');
  expect(await dialog.locator('form').evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(true);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toEqual([{ method: 'PUT', path: '/me/destruction-policy', body: { minScheduleAheadSeconds: 1800, maxScheduleAheadSeconds: 5400 } }]);
});

test('取消销毁使用契约确认框，Esc 和取消不写入，确认后成功', async ({ page, mock }) => {
  mock.keys = [createKey('PENDING_DESTRUCTION')];
  mock.destructionJobs = [createDestructionJob()];
  await mount(page, 'keys');
  const row = page.getByRole('row').filter({ hasText: '订单签名密钥' });
  await row.click();
  const action = page.getByRole('button', { name: '取消销毁', exact: true });
  await action.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => Boolean(element.closest('#micro-app [data-qiankun]')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  await action.click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  await action.click();
  await dialog.getByRole('button', { name: '取消销毁', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('取消销毁成功');
  expect(mock.writes).toEqual([{ method: 'DELETE', path: '/keys/browser-key-001/destruction', body: { expectedRowVersion: 1 } }]);
});

test('策略撤销的确认框留在子应用，取消与确认具有独立写入边界', async ({ page, mock }) => {
  await mount(page, 'policies');
  await page.getByRole('row').filter({ hasText: '订单签名密钥' }).getByRole('button', { name: '撤销策略', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '撤销密钥策略', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => Boolean(element.closest('#micro-app [data-qiankun]')))).toBe(true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  await page.getByRole('row').filter({ hasText: '订单签名密钥' }).getByRole('button', { name: '撤销策略', exact: true }).click();
  await dialog.getByRole('button', { name: '撤销策略', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('策略已撤销');
  expect(mock.writes).toEqual([{ method: 'DELETE', path: '/keys/browser-key-001/policies/browser-policy-1', body: { expectedRowVersion: 1 } }]);
});

test('业务表格键盘焦点使用自定义 focusRing，选择行为可达', async ({ page }) => {
  await mount(page, 'keys');
  await page.evaluate(() => (window as unknown as { __kmsFixture: { setTheme(mode: string): void } }).__kmsFixture.setTheme('custom'));
  const row = page.getByRole('row').filter({ hasText: '订单签名密钥' });
  await row.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(row).toBeFocused();
  const focus = await row.evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), color: style.outlineColor, width: style.outlineWidth, token: style.getPropertyValue('--iam-color-focus-ring').trim() };
  });
  expect(focus.visible).toBe(true);
  expect(focus.width).toBe('2px');
  expect(focus.color).toBe('rgb(166, 30, 77)');
  expect(focus.token.toUpperCase()).toBe('#A61E4D');
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expectNoPageOverflow(page);
});

test('API 权限拒绝显示安全错误并可重试，页面权限拒绝不加载业务列表', async ({ page, mock }) => {
  mock.keyListStatus = 403;
  await mount(page);
  await expect(page.getByRole('alert')).toContainText('没有执行该操作的权限');
  expect(await page.locator('body').innerText()).not.toMatch(/Bearer|browser-fixture-token|127\.0\.0\.1|localhost/);
  mock.keyListStatus = 200;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('订单签名密钥', { exact: true })).toBeVisible();
  mock.pagePermissions = ['kms.page.my-keys'];
  await mount(page, 'policies');
  await expect(page.getByRole('alert')).toContainText('当前身份没有访问此页面的权限');
  await expect(page.getByRole('button', { name: '创建策略', exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test('只读主体没有管理入口，各业务页保持桌面与手机布局', async ({ page, mock }) => {
  mock.scopes = ['kms.me.read', 'kms.key.read'];
  await mount(page);
  await expect(page.getByRole('button', { name: '新建密钥', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '销毁政策', exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await mount(page, 'keys');
  await expect(page.getByRole('button', { name: '创建密钥', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '创建密钥', exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await mount(page, 'policies');
  await expect(page.getByRole('button', { name: '创建策略', exact: true })).toHaveCount(0);
  await expect(page.getByText('当前身份没有读取策略的权限')).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销策略', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '选择密钥', exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await mount(page, 'destruction');
  await expect(page.getByRole('alert').filter({ hasText: '没有执行该操作的权限' }).first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test('销毁任务分页与 Worker 状态独立失败和重试，未知状态不伪装为正常', async ({ page, mock }) => {
  mock.workerHealthStatus = 503;
  mock.destructionJobs = Array.from({ length: 21 }, (_, index) => ({
    keyRef: `browser-destruction-key-${index + 1}`, keyVersion: 1, state: 'PENDING',
    dueAt: '2026-12-01T00:00:00Z', claimUntil: null, attemptCount: 0, completedAt: null
  }));
  await mount(page, 'destruction');
  const workerFailure = page.getByRole('alert').filter({ has: page.getByRole('button', { name: '重试 Worker 状态', exact: true }) });
  await expect(workerFailure).toContainText('HTTP 503');
  await expect(page.getByText('暂未取得 Worker 状态', { exact: true })).toBeVisible();
  await expect(page.getByText('最近成功扫描：未取得 · 连续失败：未取得', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'browser-destruction-key-20', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'browser-destruction-key-21', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'browser-destruction-key-21', exact: true })).toBeVisible();
  expect(mock.reads).toContain('/destruction-jobs?page=2&size=20');
  expect(mock.reads.filter(path => path === '/destruction-worker/health')).toHaveLength(1);
  const jobsReads = mock.reads.filter(path => path.startsWith('/destruction-jobs')).length;
  mock.workerHealthStatus = 200;
  await workerFailure.getByRole('button', { name: '重试 Worker 状态', exact: true }).click();
  await expect(workerFailure).toHaveCount(0);
  await expect(page.getByText('Worker 正常运行', { exact: true })).toBeVisible();
  expect(mock.reads.filter(path => path.startsWith('/destruction-jobs'))).toHaveLength(jobsReads);
  await page.getByRole('button', { name: '每页条数', exact: true }).click();
  await page.getByRole('option', { name: '50 条/页', exact: true }).click();
  await expect(page.getByRole('row')).toHaveCount(22);
  expect(mock.reads).toContain('/destruction-jobs?page=1&size=50');
  await expectNoPageOverflow(page);

  mock.destructionJobsStatus = 503;
  await mount(page, 'destruction');
  const jobsFailure = page.getByRole('alert').filter({ has: page.getByRole('button', { name: '重试销毁任务', exact: true }) });
  await expect(jobsFailure).toContainText('HTTP 503');
  await expect(page.getByText('Worker 正常运行', { exact: true })).toBeVisible();
  await expect(page.getByText('未取得任务总数', { exact: true })).toBeVisible();
  await expect(page.getByText('当前没有销毁任务', { exact: true })).toHaveCount(0);
  const workerReads = mock.reads.filter(path => path === '/destruction-worker/health').length;
  mock.destructionJobsStatus = 200;
  await jobsFailure.getByRole('button', { name: '重试销毁任务', exact: true }).click();
  await expect(jobsFailure).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'browser-destruction-key-20', exact: true })).toBeVisible();
  expect(mock.reads.filter(path => path === '/destruction-worker/health')).toHaveLength(workerReads);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

test('我的密钥可打开第 101 把详情，页面权限无需管理入口', async ({ page, mock }) => {
  mock.pagePermissions = ['kms.page.my-keys'];
  mock.scopes = ['kms.me.read', 'kms.key.read'];
  mock.keys = Array.from({ length: 101 }, (_, index) => ({
    ...createKey(), keyRef: `browser-page-key-${index + 1}`, keyAlias: `分页密钥 ${index + 1}`
  }));
  await mount(page);
  await expect(page.getByRole('row')).toHaveCount(101);
  await expect(page.getByRole('button', { name: '查看分页密钥 101详情', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看分页密钥 101详情', exact: true })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: '查看分页密钥 101详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '密钥详情', exact: true })).toContainText('browser-page-key-101');
  expect(mock.reads).toContain('/me/keys?page=2&size=100');
  expect(mock.reads.some(path => path.startsWith('/admin/'))).toBe(false);
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

test('创建策略弹窗超过 100 把仍可通过别名查找并选择目标密钥', async ({ page, mock }) => {
  mock.keys = Array.from({ length: 101 }, (_, index) => ({
    ...createKey(), keyRef: `browser-page-key-${index + 1}`, keyAlias: `分页密钥 ${index + 1}`
  }));
  await mount(page, 'policies');
  await page.getByRole('button', { name: '创建策略', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建策略', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '按别名查找密钥' }).fill('分页密钥 101');
  await dialog.getByRole('button', { name: '查找', exact: true }).click();
  const selector = dialog.getByRole('button', { name: '选择密钥', exact: true });  await expect(selector).toBeEnabled();
  await selector.click();
  await page.getByRole('option', { name: /分页密钥 101/ }).click();
  await expect(selector).toContainText('分页密钥 101');
  expect(mock.reads).toContain('/admin/keys?page=1&size=100&alias=' + encodeURIComponent('分页密钥 101').replace('%20', '+'));
  expect(mock.writes).toEqual([]);
  await expectNoPageOverflow(page);
});

