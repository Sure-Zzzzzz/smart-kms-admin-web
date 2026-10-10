import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KmsApiError, type KmsKey, type KmsPage } from '../api/kmsApi';
import { kmsState, setKmsMe } from '../kmsState';
import KeysView from './KeysView.vue';

const api = vi.hoisted(() => ({ listAdminKmsKeys: vi.fn(), createKmsKey: vi.fn(), hasPermission: vi.fn() }));
vi.mock('../api/kmsApi', async importOriginal => ({ ...await importOriginal<typeof import('../api/kmsApi')>(), ...api }));
vi.mock('../kmsState', async importOriginal => ({ ...await importOriginal<typeof import('../kmsState')>(), hasKmsApiPermission: api.hasPermission }));

const key: KmsKey = {
  ownerPrincipalId: 'iam:owner', keyRef: 'key-1', keyAlias: '签名密钥', purpose: 'SIGN',
  algorithm: 'ES256', state: 'ACTIVE', activeVersion: 1, rowVersion: 3,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z'
};
const page = (items: KmsKey[], total = items.length): KmsPage<KmsKey> => ({ items, page: 1, size: 20, total });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
let wrapper: VueWrapper;
function render() {
  wrapper = mount(KeysView, { global: { stubs: { KeyDetails: {
    name: 'KeyDetails', props: ['keyRef', 'mode', 'initialKey'], emits: ['changed', 'close'],
    template: '<section class="detail-stub">{{ keyRef }}</section>'
  } } } });
}
async function openCreateDialog() {
  await button('创建密钥').trigger('click');
  await flushPromises();
}
function button(text: string) {
  const node = wrapper.findAll('button').find(node => node.text().trim() === text);
  expect(node, `按钮 ${text}`).toBeDefined();
  return node!;
}
async function choose(label: string, option: string) {
  await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
  const node = wrapper.findAll('[role="option"]').find(node => node.text() === option);
  expect(node).toBeDefined();
  await node!.trigger('click');
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
}
async function selectFirst() {
  await wrapper.get('tbody tr[tabindex]').trigger('keydown', { key: 'Enter' });
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  setKmsMe({ principalId: 'iam:owner', subjectType: 'HUMAN', scopes: ['kms.key.manage'], pagePermissions: ['kms.page.keys'] });
  api.hasPermission.mockReturnValue(true);
  api.listAdminKmsKeys.mockResolvedValue(page([key]));
  api.createKmsKey.mockResolvedValue(key);
});
afterEach(() => { wrapper?.unmount(); setKmsMe(null); });

describe('逻辑密钥治理页面', () => {
  it.each(['resolve', 'reject'])('同主体撤manage隐藏创建并清输入，旧创建%s不显示详情或解开新提交', async completion => {
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    const stale = deferred<KmsKey>();
    const latest = deferred<KmsKey>();
    api.createKmsKey.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    render();
    await flushPromises();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[required]').setValue('旧治理创建');
    await choose('用途', '加密');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    kmsState.me!.scopes = ['kms.key.read'];
    await nextTick();
    expect(wrapper.find('[role="dialog"] form.kms-form').exists()).toBe(false);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    await nextTick();
    await openCreateDialog();
    expect(wrapper.get('[role="dialog"] form.kms-form input[required]').element).toHaveProperty('value', '');
    expect(wrapper.get('button[aria-label="用途"]').text()).toBe('签名');
    await wrapper.get('[role="dialog"] form.kms-form input[required]').setValue('新治理创建');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧manage治理失败'));
    await flushPromises();
    expect(wrapper.find('.detail-stub').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('旧manage治理失败');
    expect(wrapper.get('[role="dialog"] form.kms-form input[required]').element).toHaveProperty('value', '新治理创建');
    expect(wrapper.get('[role="dialog"] form.kms-form button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(api.listAdminKmsKeys).toHaveBeenCalledTimes(1);
    expect(api.createKmsKey.mock.calls[1][1]).not.toBe(api.createKmsKey.mock.calls[0][1]);
    latest.resolve({ ...key, keyRef: 'restored-admin-created' });
    await flushPromises();
    expect(wrapper.get('.detail-stub').text()).toBe('restored-admin-created');
  });
  it.each(['resolve', 'reject'])('同主体撤read清治理列表和详情，旧读取%s不污染恢复授权后的请求', async completion => {
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    render();
    await flushPromises();
    await selectFirst();
    expect(wrapper.find('.detail-stub').exists()).toBe(true);
    const stale = deferred<KmsPage<KmsKey>>();
    const latest = deferred<KmsPage<KmsKey>>();
    api.listAdminKmsKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    await wrapper.get('form.kms-filters').trigger('submit');
    kmsState.me!.scopes = ['kms.key.manage'];
    await nextTick();
    expect(wrapper.text()).not.toContain(key.keyAlias);
    expect(wrapper.find('.detail-stub').exists()).toBe(false);
    expect(button('查询').attributes('disabled')).toBeDefined();
    await wrapper.get('form.kms-filters').trigger('submit');
    expect(api.listAdminKmsKeys).toHaveBeenCalledTimes(2);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    if (completion === 'resolve') stale.resolve(page([key])); else stale.reject(new Error('旧read治理错误'));
    await flushPromises();
    expect(wrapper.text()).not.toContain(key.keyAlias);
    expect(wrapper.text()).not.toContain('旧read治理错误');
    expect(wrapper.get('tbody td.data-table-placeholder').text()).toContain('加载中');
    latest.resolve(page([{ ...key, keyAlias: '新授权列表' }]));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('新授权列表');
  });
  it.each(['resolve', 'reject'])('身份切换清列表和创建输入，并忽略旧列表%s结果', async completion => {
    const stale = deferred<KmsPage<KmsKey>>();
    const current = deferred<KmsPage<KmsKey>>();
    api.listAdminKmsKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    render();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[required]').setValue('旧身份输入');
    setKmsMe({ ...kmsState.me!, principalId: 'iam:next' });
    await nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await openCreateDialog();
    expect(wrapper.get('[role="dialog"] form.kms-form input[required]').element).toHaveProperty('value', '');
    if (completion === 'resolve') stale.resolve(page([key])); else stale.reject(new Error('旧身份列表错误'));
    await flushPromises();
    expect(wrapper.text()).not.toContain(key.keyAlias);
    expect(wrapper.text()).not.toContain('旧身份列表错误');
    current.resolve(page([{ ...key, keyAlias: '新身份密钥' }]));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('新身份密钥');
    setKmsMe(null);
    await flushPromises();
    expect(wrapper.text()).not.toContain('新身份密钥');
    expect(api.listAdminKmsKeys).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'])('身份切换后旧创建%s不显示详情或解锁新创建', async completion => {
    const stale = deferred<KmsKey>();
    const current = deferred<KmsKey>();
    api.createKmsKey.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    render();
    await flushPromises();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[required]').setValue('旧创建');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    setKmsMe({ ...kmsState.me!, principalId: 'iam:next' });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[required]').setValue('新创建');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧创建错误'));
    await flushPromises();
    expect(wrapper.find('.detail-stub').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('旧创建错误');
    expect(wrapper.get('[role="dialog"] form.kms-form button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(api.createKmsKey.mock.calls[1][1]).not.toBe(api.createKmsKey.mock.calls[0][1]);
    current.resolve({ ...key, keyRef: 'next-created', ownerPrincipalId: 'iam:next' });
    await flushPromises();
    expect(wrapper.get('.detail-stub').text()).toBe('next-created');
  });

  it.each(['resolve', 'reject'])('快速连续筛选时忽略旧查询的%s响应', async completion => {
    const stale = deferred<KmsPage<KmsKey>>();
    const latest = deferred<KmsPage<KmsKey>>();
    api.listAdminKmsKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    render();
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('最新');
    await wrapper.get('form.kms-filters').trigger('submit');
    latest.resolve(page([{ ...key, keyRef: 'key-latest', keyAlias: '最新密钥' }]));
    await flushPromises();
    if (completion === 'resolve') stale.resolve(page([key]));
    else stale.reject(new Error('旧筛选失败'));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('最新密钥');
    expect(wrapper.get('tbody').text()).not.toContain('签名密钥');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('tbody td.data-table-placeholder').exists()).toBe(false);
  });

  it('显示加载、空态和筛选结果，并在查询时回第一页', async () => {
    const loading = deferred<KmsPage<KmsKey>>();
    api.listAdminKmsKeys.mockReturnValueOnce(loading.promise).mockResolvedValue(page([]));
    render();
    await nextTick();
    expect(wrapper.get('tbody td.data-table-placeholder').text()).toContain('加载中');
    expect(button('查询').attributes('disabled')).toBeDefined();
    loading.resolve(page([]));
    await flushPromises();
    expect(wrapper.text()).toContain('当前授权范围内暂无密钥');
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('支付');
    await choose('按状态筛选', '已停用');
    await wrapper.get('form.kms-filters').trigger('submit');
    await flushPromises();
    expect(api.listAdminKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 20, alias: '支付', state: 'DISABLED', ownerPrincipalId: undefined });
    expect(wrapper.text()).toContain('当前筛选条件下没有匹配的密钥');
  });

  it('治理详情使用同一组件并传入正确查询模式，变更刷新列表且关闭可返回列表', async () => {
    render();
    await flushPromises();
    await selectFirst();
    const detail = wrapper.findComponent({ name: 'KeyDetails' });
    expect(detail.props()).toMatchObject({ keyRef: 'key-1', mode: 'governance', initialKey: key });
    api.listAdminKmsKeys.mockResolvedValue(page([{ ...key, rowVersion: 4 }]));
    detail.vm.$emit('changed');
    await flushPromises();
    expect(detail.props('initialKey')).toMatchObject({ rowVersion: 4 });
    detail.vm.$emit('close');
    await nextTick();
    expect(wrapper.find('.detail-stub').exists()).toBe(false);
  });

  it('治理列表提供文字详情入口，生命周期刷新不因筛选列表为空关闭详情', async () => {
    render();
    await flushPromises();
    const action = wrapper.get('button[aria-label="打开签名密钥详情"].kms-view-detail');
    expect(action.text()).toBe('查看详情');
    expect(action.find('svg').exists()).toBe(false);
    expect(wrapper.findAll('thead th')).toHaveLength(8);
    await action.trigger('click');
    const detail = wrapper.getComponent({ name: 'KeyDetails' });
    api.listAdminKmsKeys.mockResolvedValueOnce(page([]));
    detail.vm.$emit('changed');
    await flushPromises();
    expect(wrapper.getComponent({ name: 'KeyDetails' }).props()).toMatchObject({ keyRef: key.keyRef, mode: 'governance' });
    expect(wrapper.get('.data-table-placeholder[role="status"]').text()).toContain('当前授权范围内暂无密钥');
    detail.vm.$emit('close');
    await nextTick();
    expect(wrapper.find('.detail-stub').exists()).toBe(false);
  });

  it('加载错误可重试，只读主体仍可打开详情但无创建工具', async () => {
    api.hasPermission.mockImplementation(permission => permission === 'kms.key.read');
    api.listAdminKmsKeys.mockRejectedValueOnce(new Error('查询失败'));
    render();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('查询失败');
    await button('重试').trigger('click');
    await flushPromises();
    await wrapper.get('tbody tr[tabindex]').trigger('keydown', { key: ' ' });
    expect(wrapper.get('tbody tr[tabindex]').attributes('aria-selected')).toBe('true');
    expect(wrapper.find('.detail-stub').exists()).toBe(true);
    expect(wrapper.find('[role="dialog"] form.kms-form').exists()).toBe(false);
  });

  it('创建用途联动算法且失败保留输入，未知结果重试复用幂等键', async () => {
    api.createKmsKey.mockRejectedValueOnce(new Error('网络中断'));
    render();
    await flushPromises();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[maxlength]').setValue(' 加密密钥 ');
    await choose('用途', '加密');
    expect(wrapper.get('input[readonly]').element).toHaveProperty('value', 'AES-256-GCM');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('网络中断');
    expect(wrapper.get('[role="dialog"] form.kms-form input[maxlength]').element).toHaveProperty('value', '加密密钥');
    const first = api.createKmsKey.mock.lastCall!;
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    expect(api.createKmsKey.mock.lastCall).toEqual(first);
    expect(first[0]).toEqual({ keyAlias: '加密密钥', purpose: 'ENCRYPT', algorithm: 'AES_256_GCM' });
    expect(wrapper.get('[role="status"]').text()).toContain('密钥已创建');
    // 创建成功后弹窗关闭；重开后表单应为空白
    await openCreateDialog();
    expect(wrapper.get('[role="dialog"] form.kms-form input[maxlength]').element).toHaveProperty('value', '');
    await choose('用途', '签名');
    await wrapper.get('[role="dialog"] form.kms-form input[maxlength]').setValue('加密密钥');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    expect(api.createKmsKey.mock.lastCall?.[1]).not.toBe(first[1]);
  });

  it('修改创建内容或明确拒绝后建立新请求，不复用上一请求幂等键', async () => {
    api.createKmsKey.mockRejectedValueOnce(new Error('网络中断')).mockRejectedValueOnce(new KmsApiError(400, '参数拒绝'));
    render();
    await flushPromises();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[maxlength]').setValue('第一把');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    const firstKey = api.createKmsKey.mock.lastCall?.[1];
    await wrapper.get('[role="dialog"] form.kms-form input[maxlength]').setValue('第二把');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    const rejectedKey = api.createKmsKey.mock.lastCall?.[1];
    expect(rejectedKey).not.toBe(firstKey);
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    expect(api.createKmsKey.mock.lastCall?.[1]).not.toBe(rejectedKey);
  });

  it('从旧分页和筛选创建后回首屏，并用本人接口稳定打开新密钥详情', async () => {
    const created = { ...key, keyRef: 'new-key', keyAlias: '新密钥' };
    api.listAdminKmsKeys.mockResolvedValue(page([key], 101));
    api.createKmsKey.mockResolvedValue(created);
    render();
    await flushPromises();
    await button('下一页').trigger('click');
    await flushPromises();
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('旧别名');
    await choose('按状态筛选', '已停用');
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[maxlength]').setValue('新密钥');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await flushPromises();
    expect(api.listAdminKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 20, alias: undefined, state: undefined, ownerPrincipalId: undefined });
    expect(wrapper.get('input[aria-label="按别名筛选"]').element).toHaveProperty('value', '');
    expect(wrapper.findComponent({ name: 'KeyDetails' }).props()).toMatchObject({ keyRef: 'new-key', mode: 'self' });
    await selectFirst();
    expect(wrapper.findComponent({ name: 'KeyDetails' }).props('mode')).toBe('governance');
  });

  it('阻止空白和重复提交，并在卸载后忽略晚到的创建结果', async () => {
    const pending = deferred<KmsKey>();
    api.createKmsKey.mockReturnValue(pending.promise);
    render();
    await flushPromises();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    expect(api.createKmsKey).not.toHaveBeenCalled();
    await openCreateDialog();
    await wrapper.get('[role="dialog"] form.kms-form input[maxlength]').setValue('新密钥');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    await wrapper.get('[role="dialog"] form.kms-form').trigger('submit');
    expect(api.createKmsKey).toHaveBeenCalledTimes(1);
    expect(button('创建中...').attributes('disabled')).toBeDefined();
    wrapper.unmount();
    pending.resolve(key);
    await flushPromises();
    expect(api.listAdminKmsKeys).toHaveBeenCalledTimes(1);
  });

  it('可以访问第21把密钥，改变每页条数和筛选后回第一页', async () => {
    const last = { ...key, keyRef: 'key-21', keyAlias: '第21把' };
    api.listAdminKmsKeys.mockResolvedValueOnce(page([key], 101)).mockResolvedValue(page([last], 101));
    render();
    await flushPromises();
    await button('下一页').trigger('click');
    await flushPromises();
    expect(api.listAdminKmsKeys).toHaveBeenLastCalledWith({ page: 2, size: 20, alias: undefined, state: undefined, ownerPrincipalId: undefined });
    expect(wrapper.get('tbody').text()).toContain('第21把');
    await choose('每页条数', '50 条/页');
    await flushPromises();
    expect(api.listAdminKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 50, alias: undefined, state: undefined, ownerPrincipalId: undefined });
    await button('下一页').trigger('click');
    await flushPromises();
    await wrapper.get('form.kms-filters').trigger('submit');
    await flushPromises();
    expect(api.listAdminKmsKeys.mock.lastCall?.[0].page).toBe(1);
  });

  it('末页数据减少后重读最后有效页，不留下无法返回的空页', async () => {
    api.listAdminKmsKeys.mockResolvedValue(page([key], 101));
    render();
    await flushPromises();
    await button('下一页').trigger('click');
    await flushPromises();
    await selectFirst();
    api.listAdminKmsKeys.mockResolvedValueOnce(page([], 1)).mockResolvedValueOnce(page([key]));
    wrapper.findComponent({ name: 'KeyDetails' }).vm.$emit('changed');
    await flushPromises();
    expect(api.listAdminKmsKeys.mock.calls.slice(-2).map(call => call[0].page)).toEqual([2, 1]);
    expect(button('上一页').attributes('disabled')).toBeDefined();
    expect(wrapper.get('tbody').text()).toContain('签名密钥');
  });
});
