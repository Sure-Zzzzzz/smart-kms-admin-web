import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KmsKey, KmsOwnerDestructionPolicy, KmsPage } from '../api/kmsApi';
import { kmsState, setKmsMe } from '../kmsState';
import MyKeysView from './MyKeysView.vue';
import KeyDetails from '../components/KeyDetails.vue';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';

const api = vi.hoisted(() => ({
  listMyKmsKeys: vi.fn(), createKmsKey: vi.fn(), loadMyDestructionPolicy: vi.fn(),
  saveMyDestructionPolicy: vi.fn(), getMyKmsKey: vi.fn(), getMyKmsDestruction: vi.fn(), listMyKmsPublicKeys: vi.fn(),
  changeMyKmsKeyState: vi.fn(), rotateMyKmsKey: vi.fn(), cancelMyKmsDestruction: vi.fn(),
  scheduleMyKmsDestruction: vi.fn(), hasPermission: vi.fn(),
  KmsApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } }
}));
vi.mock('../api/kmsApi', () => api);
vi.mock('../kmsState', async importOriginal => ({ ...await importOriginal<typeof import('../kmsState')>(), hasKmsApiPermission: api.hasPermission }));
const key: KmsKey = {
  keyRef: 'mine', keyAlias: '我的签名密钥', purpose: 'SIGN', algorithm: 'ES256', state: 'ACTIVE',
  activeVersion: 1, rowVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
};
const page = (items: KmsKey[]): KmsPage<KmsKey> => ({ items, total: items.length, page: 1, size: 100 });
const policy: KmsOwnerDestructionPolicy = {
  exists: true, ownerPrincipalId: 'iam:owner', minScheduleAheadSeconds: 3600,
  maxScheduleAheadSeconds: 7200, rowVersion: 2
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
let wrapper: VueWrapper;
function button(text: string) {
  const node = wrapper.findAll('button').find(node => node.text() === text);
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
beforeEach(() => {
  vi.resetAllMocks();
  setKmsMe({ principalId: 'iam:owner', subjectType: 'HUMAN', scopes: ['kms.key.read', 'kms.key.manage', 'kms.key.destroy', 'kms.read-public-key'], pagePermissions: ['kms.page.my-keys'] });
  api.hasPermission.mockReturnValue(true);
  api.listMyKmsKeys.mockResolvedValue(page([key]));
  api.createKmsKey.mockResolvedValue(key);
  api.loadMyDestructionPolicy.mockResolvedValue(policy);
  api.saveMyDestructionPolicy.mockResolvedValue(policy);
  api.getMyKmsKey.mockResolvedValue(key);
  api.listMyKmsPublicKeys.mockResolvedValue([]);
  api.getMyKmsDestruction.mockImplementation(async () => {
    const current = await api.getMyKmsKey.mock.results.at(-1)!.value as KmsKey;
    return { keyRef: current.keyRef, keyState: current.state, rowVersion: current.rowVersion,
      cancelEligible: current.state === 'PENDING_DESTRUCTION',
      items: current.state === 'PENDING_DESTRUCTION' ? [{ keyVersion: 1, state: 'PENDING', dueAt: '2027-01-01T00:00:00Z', completedAt: null }] : [] };
  });
  api.scheduleMyKmsDestruction.mockImplementation(() => {
    const updated = { ...key, state: 'PENDING_DESTRUCTION', rowVersion: 2 };
    api.getMyKmsKey.mockResolvedValue(updated);
    return Promise.resolve(updated);
  });
});
afterEach(() => { wrapper?.unmount(); setKmsMe(null); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('我的密钥页面', () => {
  it.each(['resolve', 'reject'])('同主体撤manage关闭创建并清输入，旧创建%s不影响恢复后的新提交', async completion => {
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    const stale = deferred<KmsKey>();
    const latest = deferred<KmsKey>();
    api.createKmsKey.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue('旧创建输入');
    await choose('用途', '加解密（ENCRYPT）');
    await wrapper.get('form').trigger('submit');
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.destroy'];
    await nextTick();
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
    expect(wrapper.findAll('button').some(node => node.text() === '新建密钥')).toBe(false);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'];
    await nextTick();
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
    await button('新建密钥').trigger('click');
    expect(wrapper.get('form input[maxlength]').element).toHaveProperty('value', '');
    expect(wrapper.get('button[aria-label="用途"]').text()).toBe('签名（SIGN）');
    await wrapper.get('form input[maxlength]').setValue('新创建输入');
    await wrapper.get('form').trigger('submit');
    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧manage创建失败'));
    await flushPromises();
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('旧manage创建失败');
    expect(wrapper.get('form input[maxlength]').element).toHaveProperty('value', '新创建输入');
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(1);
    expect(api.createKmsKey.mock.calls[1][1]).not.toBe(api.createKmsKey.mock.calls[0][1]);
    latest.resolve({ ...key, keyRef: 'restored-created' });
    await flushPromises();
    expect(wrapper.getComponent(KeyDetails).props('keyRef')).toBe('restored-created');
  });

  it('已编辑政策撤destroy立即关闭，恢复权限不自动打开，重新回读前不残留旧输入', async () => {
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await button('销毁政策').trigger('click');
    await flushPromises();
    await wrapper.findAll('form input[type="number"]')[0].setValue('7');
    await wrapper.findAll('form input[type="number"]')[1].setValue('9');
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    await nextTick();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'];
    await nextTick();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
    const fresh = deferred<KmsOwnerDestructionPolicy>();
    api.loadMyDestructionPolicy.mockReturnValueOnce(fresh.promise);
    await button('销毁政策').trigger('click');
    for (const input of wrapper.findAll('form input[type="number"]')) {
      expect(input.element).toHaveProperty('value', '');
      expect(input.attributes('disabled')).toBeDefined();
    }
    fresh.resolve(policy);
    await flushPromises();
    expect(wrapper.findAll('form input[type="number"]')[0].element).toHaveProperty('value', '1');
  });

  it.each([
    ['read', 'resolve'], ['read', 'reject'], ['save', 'resolve'], ['save', 'reject']
  ] as const)('同主体撤destroy后旧政策%s的%s不回填、不增加修订或解开新锁', async (kind, completion) => {
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    const stale = deferred<KmsOwnerDestructionPolicy>();
    const latestRead = deferred<KmsOwnerDestructionPolicy>();
    const latestSave = deferred<KmsOwnerDestructionPolicy>();
    if (kind === 'read') api.loadMyDestructionPolicy.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latestRead.promise);
    else api.saveMyDestructionPolicy.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latestSave.promise);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await wrapper.get('button.kms-view-detail').trigger('click');
    await button('销毁政策').trigger('click');
    if (kind === 'save') {
      await flushPromises();
      await wrapper.findAll('form input[type="number"]')[0].setValue('7');
      await wrapper.findAll('form input[type="number"]')[1].setValue('8');
      await wrapper.get('form').trigger('submit');
    }
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    await nextTick();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'];
    await nextTick();
    await button('销毁政策').trigger('click');
    if (kind === 'save') {
      await flushPromises();
      await wrapper.findAll('form input[type="number"]')[0].setValue('3');
      await wrapper.findAll('form input[type="number"]')[1].setValue('4');
      await wrapper.get('form').trigger('submit');
    }
    if (completion === 'resolve') stale.resolve({ ...policy, minScheduleAheadSeconds: 25200 });
    else stale.reject(new Error('旧destroy政策失败'));
    await flushPromises();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('旧destroy政策失败');
    expect(wrapper.getComponent(KeyDetails).props('policyRevision')).toBe(0);
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('form input[type="number"]')[0].element).toHaveProperty('value', kind === 'read' ? '' : '3');
    if (kind === 'read') {
      latestRead.resolve({ ...policy, minScheduleAheadSeconds: 10800, maxScheduleAheadSeconds: 14400 });
      await flushPromises();
      expect(wrapper.findAll('form input[type="number"]')[0].element).toHaveProperty('value', '3');
      expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeUndefined();
      expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
    } else {
      latestSave.resolve(policy);
      await flushPromises();
      expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
      expect(wrapper.getComponent(KeyDetails).props('policyRevision')).toBe(1);
      expect(api.saveMyDestructionPolicy).toHaveBeenCalledTimes(2);
    }
  });

  it.each(['create', 'policy'])('%s请求不因无关操作权限被撤销而取消', async action => {
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    const pending = deferred<KmsKey | KmsOwnerDestructionPolicy>();
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    if (action === 'create') {
      api.createKmsKey.mockReturnValueOnce(pending.promise);
      await button('新建密钥').trigger('click');
      await wrapper.get('form input[maxlength]').setValue('合法创建');
    } else {
      api.saveMyDestructionPolicy.mockReturnValueOnce(pending.promise);
      await wrapper.get('button.kms-view-detail').trigger('click');
      await button('销毁政策').trigger('click');
      await flushPromises();
    }
    await wrapper.get('form').trigger('submit');
    kmsState.me!.scopes = kmsState.me!.scopes.filter(permission => permission !== (action === 'create' ? 'kms.key.destroy' : 'kms.key.manage'));
    await nextTick();
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
    pending.resolve(action === 'create' ? key : policy);
    await flushPromises();
    if (action === 'create') expect(wrapper.getComponent(KeyDetails).props('keyRef')).toBe(key.keyRef);
    else expect(wrapper.getComponent(KeyDetails).props('policyRevision')).toBe(1);
  });
  it.each(['resolve', 'reject'])('同主体撤read清列表和选择，恢复后旧读取%s不回填或解锁新读取', async completion => {
    api.hasPermission.mockImplementation(permission => kmsState.me?.scopes.includes(permission) === true);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await wrapper.get('button.kms-view-detail').trigger('click');
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(true);
    const stale = deferred<KmsPage<KmsKey>>();
    const latest = deferred<KmsPage<KmsKey>>();
    api.listMyKmsKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    await button('查询').trigger('click');
    kmsState.me!.scopes = ['kms.key.manage'];
    await nextTick();
    expect(wrapper.get('tbody').text()).not.toContain(key.keyAlias);
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(false);
    expect(button('查询').attributes('disabled')).toBeDefined();
    await button('查询').trigger('click');
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(2);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage'];
    if (completion === 'resolve') stale.resolve(page([key])); else stale.reject(new Error('旧read列表错误'));
    await flushPromises();
    expect(wrapper.get('tbody').text()).not.toContain(key.keyAlias);
    expect(wrapper.text()).not.toContain('旧read列表错误');
    expect(wrapper.get('.kms-table-wrap').attributes('aria-busy')).toBe('true');
    latest.resolve(page([{ ...key, keyAlias: '恢复授权后的列表' }]));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('恢复授权后的列表');
  });
  it.each(['resolve', 'reject'])('切换身份清除列表，旧列表%s不能覆盖新身份或触发错误', async completion => {
    const stale = deferred<KmsPage<KmsKey>>();
    const current = deferred<KmsPage<KmsKey>>();
    api.listMyKmsKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    setKmsMe({ ...kmsState.me!, principalId: 'iam:next' });
    if (completion === 'resolve') stale.resolve(page([key])); else stale.reject(new Error('旧本人列表错误'));
    await flushPromises();
    expect(wrapper.get('tbody').text()).not.toContain(key.keyAlias);
    expect(wrapper.text()).not.toContain('旧本人列表错误');
    current.resolve(page([{ ...key, keyAlias: '新身份密钥' }]));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('新身份密钥');
    setKmsMe(null);
    await flushPromises();
    expect(wrapper.get('tbody').text()).not.toContain('新身份密钥');
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'])('旧身份创建%s不打开旧详情、不关闭或解锁新创建表单', async completion => {
    const stale = deferred<KmsKey>();
    const current = deferred<KmsKey>();
    api.createKmsKey.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue('旧创建');
    await wrapper.get('form').trigger('submit');
    setKmsMe({ ...kmsState.me!, principalId: 'iam:next' });
    await flushPromises();
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue('新创建');
    await wrapper.get('form').trigger('submit');
    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧创建错误'));
    await flushPromises();
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('旧创建错误');
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(api.createKmsKey.mock.calls[1][1]).not.toBe(api.createKmsKey.mock.calls[0][1]);
    current.resolve({ ...key, keyRef: 'next-created' });
    await flushPromises();
    expect(wrapper.getComponent(KeyDetails).props('initialKey')).toMatchObject({ ownerPrincipalId: 'iam:next' });
  });

  it.each([
    ['read', 'resolve'], ['read', 'reject'], ['save', 'resolve'], ['save', 'reject']
  ] as const)('切换身份后旧销毁政策%s的%s不覆盖新表单或提交状态', async (kind, completion) => {
    const stale = deferred<KmsOwnerDestructionPolicy>();
    const currentSave = deferred<KmsOwnerDestructionPolicy>();
    if (kind === 'read') api.loadMyDestructionPolicy.mockReturnValueOnce(stale.promise);
    else api.saveMyDestructionPolicy.mockReturnValueOnce(stale.promise).mockReturnValueOnce(currentSave.promise);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await button('销毁政策').trigger('click');
    if (kind === 'save') { await flushPromises(); await wrapper.get('form').trigger('submit'); }
    api.loadMyDestructionPolicy.mockResolvedValue({ ...policy, ownerPrincipalId: 'iam:next', minScheduleAheadSeconds: 10800, maxScheduleAheadSeconds: 14400 });
    setKmsMe({ ...kmsState.me!, principalId: 'iam:next' });
    await flushPromises();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
    await button('销毁政策').trigger('click');
    await flushPromises();
    if (kind === 'save') await wrapper.get('form').trigger('submit');
    if (completion === 'resolve') stale.resolve(policy); else stale.reject(new Error('旧政策错误'));
    await flushPromises();
    expect(wrapper.findAll('form input[type="number"]')[0].element).toHaveProperty('value', '3');
    expect(wrapper.text()).not.toContain('旧政策错误');
    if (kind === 'save') {
      expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
      currentSave.resolve(policy);
      await flushPromises();
      expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
    }
  });

  it('在后续页和筛选中创建后清筛选回第一页，列表暂未返回新密钥也保留创建详情', async () => {
    api.listMyKmsKeys.mockResolvedValue({ ...page([key]), total: 201 });
    const created = { ...key, keyRef: 'new-key', keyAlias: '刚创建的密钥' };
    api.createKmsKey.mockResolvedValue(created);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('旧密钥');
    await choose('按状态筛选', '已停用');
    wrapper.getComponent(Pagination).vm.$emit('update:current', 3);
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue(created.keyAlias);
    api.listMyKmsKeys.mockResolvedValueOnce(page([]));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 100, alias: undefined, state: undefined });
    expect(wrapper.get('input[aria-label="按别名筛选"]').element).toHaveProperty('value', '');
    expect(wrapper.get('button[aria-label="按状态筛选"]').text()).toContain('全部状态');
    expect(wrapper.getComponent(KeyDetails).props()).toMatchObject({ keyRef: 'new-key', initialKey: { ...created, ownerPrincipalId: 'iam:owner' } });
    expect(wrapper.get('[role="status"]').text()).toContain('密钥已创建');
    api.listMyKmsKeys.mockResolvedValueOnce(page([]));
    await button('查询').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(KeyDetails).props('keyRef')).toBe(created.keyRef);
  });

  it('创建成功后列表读取失败仍打开真实本人详情，创建结果已提供owner则保留', async () => {
    const created = { ...key, keyRef: 'created-key', keyAlias: '新创建的密钥', ownerPrincipalId: 'iam:owner' };
    api.createKmsKey.mockResolvedValue(created);
    api.getMyKmsKey.mockResolvedValue(created);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyPublicKeys: true } } });
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue(created.keyAlias);
    api.listMyKmsKeys.mockRejectedValueOnce(new Error('列表读取失败'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledWith('created-key');
    expect(wrapper.get('.entity-drawer').text()).toContain('新创建的密钥');
    expect(wrapper.get('[role="alert"]').text()).toContain('列表读取失败');
    expect(wrapper.get('[role="status"]').text()).toContain('密钥已创建');
    expect(wrapper.getComponent(KeyDetails).props('initialKey')).toEqual(created);
    api.listMyKmsKeys.mockResolvedValueOnce(page([created]));
    await button('重试').trigger('click');
    await flushPromises();
    expect(wrapper.getComponent(KeyDetails).props('keyRef')).toBe(created.keyRef);
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(false);
  });

  it.each(['create', 'policy'])('%s提交后卸载不再回读或更新政策关联', async (action) => {
    wrapper = mount(MyKeysView);
    await flushPromises();
    const pending = deferred<KmsKey | KmsOwnerDestructionPolicy>();
    if (action === 'create') {
      api.createKmsKey.mockReturnValueOnce(pending.promise);
      await button('新建密钥').trigger('click');
      await wrapper.get('form input[maxlength]').setValue('卸载测试');
    } else {
      api.saveMyDestructionPolicy.mockReturnValueOnce(pending.promise);
      await button('销毁政策').trigger('click');
      await flushPromises();
    }
    await wrapper.get('form').trigger('submit');
    wrapper.unmount();
    pending.resolve(action === 'create' ? key : policy);
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(1);
  });

  it('详情入口调用真实本人接口，详情可编辑政策并在保存后回读关联窗口', async () => {
    wrapper = mount(MyKeysView, { global: { stubs: { KeyPublicKeys: true } } });
    await flushPromises();
    await wrapper.get('button[aria-label="查看我的签名密钥详情"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('button[aria-label="查看我的签名密钥详情"]').text()).toBe('查看详情');
    expect(wrapper.get('button[aria-label="查看我的签名密钥详情"]').find('svg').exists()).toBe(false);
    expect(api.getMyKmsKey).toHaveBeenCalledWith('mine');
    expect(wrapper.get('[aria-label="密钥详情"]').text()).toContain('归属人销毁政策');
    await button('修改销毁政策').trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="销毁窗口政策"]').text()).toContain('我名下的全部密钥');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.loadMyDestructionPolicy).toHaveBeenCalledTimes(3);
    wrapper.findComponent(KeyDetails).vm.$emit('changed');
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(2);
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(false);
  });

  it('共享分页可访问后续密钥，筛选及改变每页数量回第一页', async () => {
    api.listMyKmsKeys.mockResolvedValue({ ...page([key]), total: 201 });
    wrapper = mount(MyKeysView);
    await flushPromises();
    wrapper.findComponent(Pagination).vm.$emit('update:current', 3);
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenLastCalledWith({ page: 3, size: 100, alias: undefined, state: undefined });
    wrapper.findComponent(Pagination).vm.$emit('update:pageSize', 20);
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 20, alias: undefined, state: undefined });
    wrapper.findComponent(Pagination).vm.$emit('update:current', 2);
    await flushPromises();
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('签名');
    await button('查询').trigger('click');
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 20, alias: '签名', state: undefined });
  });

  it('变更后保留当前页，页码越界时回读最后有效页，列表缺少所选密钥仍保留详情', async () => {
    api.listMyKmsKeys.mockResolvedValue({ ...page([key]), total: 201 });
    wrapper = mount(MyKeysView, { global: { stubs: { KeyDetails: true } } });
    await flushPromises();
    wrapper.findComponent(Pagination).vm.$emit('update:current', 3);
    await flushPromises();
    await wrapper.get('button[aria-label="查看我的签名密钥详情"]').trigger('click');
    api.listMyKmsKeys.mockResolvedValueOnce({ ...page([]), total: 100 }).mockResolvedValueOnce({ ...page([key]), total: 100 });
    wrapper.findComponent(KeyDetails).vm.$emit('changed');
    await flushPromises();
    expect(api.listMyKmsKeys.mock.calls.slice(-2).map(call => call[0].page)).toEqual([3, 1]);
    expect(wrapper.findComponent(Pagination).props('current')).toBe(1);
    api.listMyKmsKeys.mockResolvedValueOnce(page([]));
    await button('查询').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(KeyDetails).props('keyRef')).toBe(key.keyRef);
  });

  it('安排销毁后当前活动筛选返回空列表时保持详情和成功反馈', async () => {
    wrapper = mount(MyKeysView, { global: { stubs: { KeyPublicKeys: true } } });
    await flushPromises();
    await choose('按状态筛选', '活动');
    await button('查询').trigger('click');
    await flushPromises();
    await wrapper.get('button[aria-label="查看我的签名密钥详情"]').trigger('click');
    await flushPromises();
    const due = new Date(Date.now() + 1.5 * 3600000);
    const local = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}T${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
    await wrapper.get('[aria-label="销毁时间"]').setValue(local);
    await button('安排销毁').trigger('click');
    api.listMyKmsKeys.mockResolvedValueOnce(page([]));
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    await flushPromises();
    expect(api.scheduleMyKmsDestruction).toHaveBeenCalledWith(key.keyRef, new Date(local).toISOString(), key.rowVersion, expect.any(String));
    expect(wrapper.get('.entity-drawer .kms-facts').text()).toContain('PENDING_DESTRUCTION');
    expect(wrapper.get('.entity-drawer [role="status"]').text()).toContain('安排销毁成功');
    expect(wrapper.get('tbody').text()).toContain('当前筛选条件下没有匹配的密钥');
  });

  it.each(['cancel', 'backdrop', 'escape'])('详情中的政策通过%s关闭时保留抽屉并恢复焦点', async (entry) => {
    wrapper = mount(MyKeysView, { attachTo: document.body, global: { stubs: { KeyPublicKeys: true } } });
    await flushPromises();
    await wrapper.get('button[aria-label="查看我的签名密钥详情"]').trigger('click');
    await flushPromises();
    const source = button('修改销毁政策');
    (source.element as HTMLElement).focus();
    await source.trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[aria-label="销毁窗口政策"]').element);
    expect(wrapper.getComponent(KeyDetails).props('closeBlocked')).toBe(true);
    await wrapper.get('.drawer-backdrop').trigger('click');
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(true);
    if (entry === 'cancel') await button('取消').trigger('click');
    else if (entry === 'backdrop') await wrapper.get('.dialog-backdrop').trigger('click');
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
    expect(wrapper.find('.entity-drawer').exists()).toBe(true);
    expect(document.activeElement).toBe(source.element);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.findComponent(KeyDetails).exists()).toBe(false);
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
  });

  it.each(['create', 'policy'])('上层%s弹窗消费Escape，后续document监听器只收到下一次关闭详情的事件', async (action) => {
    wrapper = mount(MyKeysView, { global: { stubs: { KeyPublicKeys: true } } });
    await flushPromises();
    await wrapper.get('button[aria-label="查看我的签名密钥详情"]').trigger('click');
    await flushPromises();
    await button(action === 'create' ? '新建密钥' : '修改销毁政策').trigger('click');
    await flushPromises();
    const nextLayer = vi.fn();
    document.addEventListener('keydown', nextLayer);
    try {
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(escape);
      await nextTick();
      expect(escape.defaultPrevented).toBe(true);
      expect(nextLayer).not.toHaveBeenCalled();
      expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
      expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(false);
      expect(wrapper.find('.entity-drawer').exists()).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();
      expect(nextLayer).toHaveBeenCalledTimes(1);
      expect(wrapper.find('.entity-drawer').exists()).toBe(false);
    } finally {
      document.removeEventListener('keydown', nextLayer);
    }
  });

  it.each(['create', 'policy'])('上层%s提交中消费Escape，保护弹窗和详情直到提交完成', async (action) => {
    const pending = deferred<KmsKey | KmsOwnerDestructionPolicy>();
    if (action === 'create') api.createKmsKey.mockReturnValueOnce(pending.promise);
    else api.saveMyDestructionPolicy.mockReturnValueOnce(pending.promise);
    wrapper = mount(MyKeysView, { global: { stubs: { KeyPublicKeys: true } } });
    await flushPromises();
    await wrapper.get('button[aria-label="查看我的签名密钥详情"]').trigger('click');
    await flushPromises();
    await button(action === 'create' ? '新建密钥' : '修改销毁政策').trigger('click');
    await flushPromises();
    if (action === 'create') await wrapper.get('form input[maxlength]').setValue('提交中的密钥');
    await wrapper.get('form').trigger('submit');
    const nextLayer = vi.fn();
    document.addEventListener('keydown', nextLayer);
    try {
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(escape);
      await nextTick();
      expect(escape.defaultPrevented).toBe(true);
      expect(nextLayer).not.toHaveBeenCalled();
      expect(wrapper.find(`[aria-label="${action === 'create' ? '新建密钥' : '销毁窗口政策'}"]`).exists()).toBe(true);
      expect(wrapper.find('.entity-drawer').exists()).toBe(true);
      pending.resolve(action === 'create' ? key : policy);
      await flushPromises();
      expect(wrapper.find(`[aria-label="${action === 'create' ? '新建密钥' : '销毁窗口政策'}"]`).exists()).toBe(false);
      expect(wrapper.find('.entity-drawer').exists()).toBe(true);
    } finally {
      document.removeEventListener('keydown', nextLayer);
    }
  });

  it('创建表单中的用途选项优先消费Escape，保留创建弹窗', async () => {
    wrapper = mount(MyKeysView, { attachTo: document.body });
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('button[aria-label="用途"]').trigger('click');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    await wrapper.get('button[aria-label="用途"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(true);
  });

  it('创建失败相同请求复用幂等键，变更输入才生成新键', async () => {
    api.createKmsKey.mockRejectedValueOnce(new Error('未知结果')).mockRejectedValueOnce(new Error('未知结果'));
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue('第一把');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createKmsKey.mock.calls[1]).toEqual(api.createKmsKey.mock.calls[0]);
    await wrapper.get('form input[maxlength]').setValue('第二把');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createKmsKey.mock.calls[2][1]).not.toEqual(api.createKmsKey.mock.calls[0][1]);
  });

  it.each(['resolve', 'reject'])('卸载后忽略列表%s结果', async (completion) => {
    const pending = deferred<KmsPage<KmsKey>>();
    api.listMyKmsKeys.mockReturnValueOnce(pending.promise);
    wrapper = mount(MyKeysView);
    wrapper.unmount();
    if (completion === 'resolve') pending.resolve(page([key])); else pending.reject(new Error('旧页失败'));
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'])('快速连续筛选时忽略旧查询的%s响应', async (completion) => {
    const stale = deferred<KmsPage<KmsKey>>();
    const latest = deferred<KmsPage<KmsKey>>();
    api.listMyKmsKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    wrapper = mount(MyKeysView);
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('最新');
    await wrapper.get('input[aria-label="按别名筛选"]').trigger('keyup', { key: 'Enter' });
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(2);
    const latestKey = { ...key, keyRef: 'mine-latest', keyAlias: '最新个人密钥' };
    latest.resolve(page([latestKey]));
    await flushPromises();
    if (completion === 'resolve') stale.resolve(page([key]));
    else stale.reject(new Error('旧筛选失败'));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('最新个人密钥');
    expect(wrapper.get('tbody').text()).not.toContain('我的签名密钥');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.kms-table-wrap').attributes('aria-busy')).toBe('false');
  });

  it('显示加载、归属空态和筛选空态，查询使用所选状态', async () => {
    const pending = deferred<KmsPage<KmsKey>>();
    api.listMyKmsKeys.mockReturnValueOnce(pending.promise).mockResolvedValue(page([]));
    wrapper = mount(MyKeysView);
    await nextTick();
    expect(wrapper.text()).toContain('正在加载密钥');
    pending.resolve(page([]));
    await flushPromises();
    expect(wrapper.text()).toContain('暂无密钥，点击右上角');
    await wrapper.get('input[aria-label="按别名筛选"]').setValue('支付');
    await choose('按状态筛选', '待销毁');
    await button('查询').trigger('click');
    await flushPromises();
    expect(api.listMyKmsKeys).toHaveBeenLastCalledWith({ page: 1, size: 100, alias: '支付', state: 'PENDING_DESTRUCTION' });
    expect(wrapper.text()).toContain('当前筛选条件下没有匹配的密钥');
    await wrapper.get('input[aria-label="按别名筛选"]').trigger('keyup', { key: 'Enter' });
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(3);
  });

  it('只有读权限时不暴露创建和政策入口，加载失败可重试', async () => {
    api.hasPermission.mockImplementation(permission => permission === 'kms.key.read');
    api.listMyKmsKeys.mockRejectedValueOnce(new Error('查询失败')).mockResolvedValue(page([]));
    wrapper = mount(MyKeysView);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('查询失败');
    await button('重试').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.page-header button')).toHaveLength(0);
    expect(wrapper.text()).toContain('暂无密钥');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(api.createKmsKey).not.toHaveBeenCalled();
    expect(api.loadMyDestructionPolicy).not.toHaveBeenCalled();
  });

  it('创建表单取消不写请求，用途切换同步算法并正确创建', async () => {
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form').trigger('submit');
    expect(api.createKmsKey).not.toHaveBeenCalled();
    await button('取消').trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue(' 加密密钥 ');
    await choose('用途', '加解密（ENCRYPT）');
    expect(wrapper.get('button[aria-label="算法"]').text()).toContain('AES-256-GCM');
    await choose('算法', 'AES-256-GCM（对称）');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createKmsKey).toHaveBeenCalledWith({ keyAlias: '加密密钥', purpose: 'ENCRYPT', algorithm: 'AES_256_GCM' }, expect.any(String));
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
    expect(wrapper.find('.entity-drawer').exists()).toBe(true);
    expect(api.listMyKmsKeys).toHaveBeenCalledTimes(2);
    await button('新建密钥').trigger('click');
    expect(wrapper.get('form input[maxlength]').element).toHaveProperty('value', '');
    expect(wrapper.get('button[aria-label="算法"]').text()).toContain('ES256');
    await wrapper.get('.dialog-backdrop').trigger('click');
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
    expect(wrapper.find('.entity-drawer').exists()).toBe(true);
  });

  it('创建期间禁用取消并阻止重复提交，失败后保留输入可重试', async () => {
    const pending = deferred<KmsKey>();
    api.createKmsKey.mockReturnValueOnce(pending.promise);
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('新建密钥').trigger('click');
    await wrapper.get('form input[maxlength]').setValue('重试密钥');
    await wrapper.get('form').trigger('submit');
    expect(button('取消').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    await wrapper.get('.dialog-backdrop').trigger('click');
    expect(api.createKmsKey).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    pending.reject(new Error('创建失败'));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('创建失败');
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('创建失败');
    expect(wrapper.get('form input[maxlength]').element).toHaveProperty('value', '重试密钥');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[aria-label="新建密钥"]').exists()).toBe(false);
    expect(wrapper.find('.entity-drawer').exists()).toBe(true);
  });

  it('政策回读期间禁用编辑和保存，编辑小时后保存对应秒数', async () => {
    const reading = deferred<KmsOwnerDestructionPolicy>();
    const saving = deferred<KmsOwnerDestructionPolicy>();
    api.loadMyDestructionPolicy.mockReturnValueOnce(reading.promise);
    api.saveMyDestructionPolicy.mockReturnValueOnce(saving.promise);
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    expect(wrapper.get('form input[type="number"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
    reading.resolve(policy);
    await flushPromises();
    const fields = wrapper.findAll('form input[type="number"]');
    expect(fields[0].element).toHaveProperty('value', '1');
    expect(fields[1].element).toHaveProperty('value', '2');
    await fields[0].setValue('1.5');
    expect((fields[0].element as HTMLInputElement).checkValidity()).toBe(true);
    await fields[1].setValue('');
    await wrapper.get('form').trigger('submit');
    expect(api.saveMyDestructionPolicy).toHaveBeenCalledWith({ minScheduleAheadSeconds: 5400, maxScheduleAheadSeconds: null });
    expect(button('取消').attributes('disabled')).toBeDefined();
    await wrapper.get('.dialog-backdrop').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.find('[aria-label="销毁窗口政策"]').exists()).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(api.saveMyDestructionPolicy).toHaveBeenCalledTimes(1);
    saving.resolve(policy);
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('政策读取失败禁止保存，重试成功后可清空限制', async () => {
    api.loadMyDestructionPolicy.mockRejectedValueOnce(new Error('政策读取失败'))
      .mockResolvedValueOnce({ ...policy, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null });
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('政策读取失败');
    await wrapper.get('form').trigger('submit');
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
    await button('重试').trigger('click');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveMyDestructionPolicy).toHaveBeenCalledWith({ minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null });
  });

  it.each([['-1', '8'], ['1', '-1'], ['5', '2']])('无效政策 %s/%s 不提交，修改后可以保存', async (min, max) => {
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    await flushPromises();
    const fields = wrapper.findAll('form input[type="number"]');
    await fields[0].setValue(min);
    await fields[1].setValue(max);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('销毁窗口无效');
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
    await fields[0].setValue('0');
    await fields[1].setValue('2');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveMyDestructionPolicy).toHaveBeenCalledWith({ minScheduleAheadSeconds: 0, maxScheduleAheadSeconds: 7200 });
  });

  it.each([0, 1])('第%d项小时数转换溢出时不以null清除限制', async (fieldIndex) => {
    api.loadMyDestructionPolicy.mockResolvedValue({ ...policy, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null });
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    await flushPromises();
    const fields = wrapper.findAll('form input[type="number"]');
    await fields[fieldIndex].setValue('1e308');
    expect((fields[fieldIndex].element as HTMLInputElement).checkValidity()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('小时数过大');
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
  });

  it.each([0, 1])('第%d项提前量超过服务端87600小时上限时明确拒绝，不发请求', async (fieldIndex) => {
    api.loadMyDestructionPolicy.mockResolvedValue({ ...policy, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null });
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    await flushPromises();
    const fields = wrapper.findAll('form input[type="number"]');
    expect(fields[fieldIndex].attributes('max')).toBe('87600');
    await fields[fieldIndex].setValue('87601');
    expect((fields[fieldIndex].element as HTMLInputElement).checkValidity()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('不能超过 87600 小时');
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
    await fields[fieldIndex].setValue('87600');
    expect((fields[fieldIndex].element as HTMLInputElement).checkValidity()).toBe(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveMyDestructionPolicy).toHaveBeenCalledWith({
      minScheduleAheadSeconds: fieldIndex === 0 ? 315_360_000 : null,
      maxScheduleAheadSeconds: fieldIndex === 1 ? 315_360_000 : null
    });
  });

  it('政策保存失败保留编辑和提示，重试成功关闭', async () => {
    api.loadMyDestructionPolicy.mockResolvedValue({ ...policy, exists: false });
    api.saveMyDestructionPolicy.mockRejectedValueOnce(new Error('政策保存失败'));
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    await flushPromises();
    await wrapper.findAll('form input[type="number"]')[1].setValue('2');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('政策保存失败');
    expect(wrapper.findAll('form input[type="number"]')[1].element).toHaveProperty('value', '2');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('重新打开政策时忽略前一次慢回读，取消不保存', async () => {
    const stale = deferred<KmsOwnerDestructionPolicy>();
    api.loadMyDestructionPolicy.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ ...policy, minScheduleAheadSeconds: 10800 });
    wrapper = mount(MyKeysView);
    await flushPromises();
    await button('销毁政策').trigger('click');
    await button('取消').trigger('click');
    await button('销毁政策').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('form input[type="number"]')[0].element).toHaveProperty('value', '3');
    stale.resolve(policy);
    await flushPromises();
    expect(wrapper.findAll('form input[type="number"]')[0].element).toHaveProperty('value', '3');
    await wrapper.get('.dialog-backdrop').trigger('click');
    expect(api.saveMyDestructionPolicy).not.toHaveBeenCalled();
  });
});
