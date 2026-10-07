import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KmsKey, KmsKeyDestructionDetails, KmsOwnerDestructionPolicy } from '../api/kmsApi';
import { kmsState, setKmsMe } from '../kmsState';
import KeyDetails from './KeyDetails.vue';

const api = vi.hoisted(() => ({
  getMyKmsKey: vi.fn(), getAdminKmsKey: vi.fn(), getMyKmsDestruction: vi.fn(), getAdminKmsDestruction: vi.fn(), getOwnerDestructionPolicy: vi.fn(),
  loadMyDestructionPolicy: vi.fn(), changeMyKmsKeyState: vi.fn(), rotateMyKmsKey: vi.fn(),
  scheduleMyKmsDestruction: vi.fn(), cancelMyKmsDestruction: vi.fn(),
  changeKmsKeyState: vi.fn(), rotateKmsKey: vi.fn(), scheduleKmsDestruction: vi.fn(), cancelKmsDestruction: vi.fn(),
  KmsApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } }
}));
vi.mock('../api/kmsApi', () => api);
const key: KmsKey = {
  keyRef: 'mine', keyAlias: '签名密钥', purpose: 'SIGN', algorithm: 'ES256', state: 'ACTIVE',
  activeVersion: 2, rowVersion: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z'
};
const policy: KmsOwnerDestructionPolicy = {
  ownerPrincipalId: 'iam:me', exists: true, minScheduleAheadSeconds: 3600,
  maxScheduleAheadSeconds: 7200, rowVersion: 1
};
function destructionFor(value: KmsKey): KmsKeyDestructionDetails {
  const scheduled = value.state === 'PENDING_DESTRUCTION' || value.state === 'DESTROYED';
  return { keyRef: value.keyRef, keyState: value.state, rowVersion: value.rowVersion,
    cancelEligible: value.state === 'PENDING_DESTRUCTION',
    items: scheduled ? [1, 2].map(keyVersion => ({ keyVersion,
      state: value.state === 'DESTROYED' ? 'COMPLETED' : 'PENDING',
      dueAt: '2026-10-06T00:00:00Z', completedAt: value.state === 'DESTROYED' ? '2026-10-06T00:01:00Z' : null })) : [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let wrapper: VueWrapper;
function render(props: { keyRef: string; mode?: 'self' | 'governance'; initialKey?: KmsKey; policyEditable?: boolean; closeBlocked?: boolean } = { keyRef: 'mine' }, attachTo?: Element) {
  wrapper = mount(KeyDetails, { props, attachTo, global: { stubs: { KeyPublicKeys: true } } });
}
function button(label: string) {
  const node = wrapper.findAll('button').find(node => node.text() === label);
  expect(node, label).toBeDefined();
  return node!;
}
async function confirm() { await wrapper.get('[role="alertdialog"] .button-danger').trigger('click'); await flushPromises(); }
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  setKmsMe({ principalId: 'iam:me', subjectType: 'HUMAN', scopes: ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'], pagePermissions: ['kms.page.my-keys'] });
  api.getMyKmsKey.mockResolvedValue(key);
  api.getAdminKmsKey.mockResolvedValue({ ...key, ownerPrincipalId: 'iam:other' });
  for (const [getDetail, getDestruction] of [[api.getMyKmsKey, api.getMyKmsDestruction], [api.getAdminKmsKey, api.getAdminKmsDestruction]]) {
    getDestruction.mockImplementation(async () => destructionFor(await getDetail.mock.results.at(-1)!.value as KmsKey));
  }
  api.loadMyDestructionPolicy.mockResolvedValue(policy);
  api.getOwnerDestructionPolicy.mockResolvedValue({ ...policy, ownerPrincipalId: 'iam:other' });
  for (const [mode, getDetail, changeState, rotate, schedule] of [
    ['self', api.getMyKmsKey, api.changeMyKmsKeyState, api.rotateMyKmsKey, api.scheduleMyKmsDestruction],
    ['governance', api.getAdminKmsKey, api.changeKmsKeyState, api.rotateKmsKey, api.scheduleKmsDestruction]
  ] as const) {
    const updated = (result: KmsKey) => {
      const stored = { ...result, ...(mode === 'governance' ? { ownerPrincipalId: 'iam:other' } : {}) };
      getDetail.mockResolvedValue(stored);
      return Promise.resolve(stored);
    };
    changeState.mockImplementation((_ref, state) => updated({ ...key, state, rowVersion: 4 }));
    rotate.mockImplementation(() => updated({ ...key, activeVersion: 3, rowVersion: 4 }));
    schedule.mockImplementation(() => updated({ ...key, state: 'PENDING_DESTRUCTION', rowVersion: 4 }));
  }
  api.cancelMyKmsDestruction.mockResolvedValue(undefined);
  api.cancelKmsDestruction.mockResolvedValue(undefined);
});
afterEach(() => { wrapper?.unmount(); document.body.replaceChildren(); setKmsMe(null); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('密钥详情与生命周期', () => {
  it('首次打开共享抽屉聚焦详情，关闭后恢复列表入口焦点且不嵌套数据面板', async () => {
    const source = document.createElement('button');
    document.body.append(source);
    source.focus();
    render({ keyRef: 'mine' }, document.body);
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('.entity-drawer').element);
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe(key.keyAlias);
    expect(wrapper.find('.drawer-content .admin-data-surface').exists()).toBe(false);
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(document.activeElement).toBe(source);
  });

  it.each(['button', 'backdrop', 'escape'])('通过%s正常关闭详情抽屉', async (entry) => {
    render();
    await flushPromises();
    if (entry === 'button') await wrapper.get('[aria-label="关闭"]').trigger('click');
    else if (entry === 'backdrop') await wrapper.get('.drawer-backdrop').trigger('click');
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('确认框打开时关闭和遮罩不会关闭详情，Escape只取消确认且下一次可关闭抽屉', async () => {
    render();
    await flushPromises();
    await button('轮换').trigger('click');
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    await wrapper.get('.drawer-backdrop').trigger('click');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
    expect(wrapper.emitted('close')).toBeUndefined();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.find('.entity-drawer').exists()).toBe(true);
    expect(wrapper.emitted('close')).toBeUndefined();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(api.rotateMyKmsKey).not.toHaveBeenCalled();
  });

  it('外层政策打开时保留抽屉，政策关闭后恢复关闭操作', async () => {
    render({ keyRef: 'mine', closeBlocked: true });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.setProps({ closeBlocked: false });
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it.each(['resolve', 'reject'])('复制请求后切换密钥忽略旧%s提示', async (completion) => {
    const pending = deferred<void>();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockReturnValue(pending.promise) } });
    render();
    await flushPromises();
    await wrapper.get('[aria-label="复制密钥标识"]').trigger('click');
    api.getMyKmsKey.mockResolvedValue({ ...key, keyRef: 'second', keyAlias: '第二把' });
    await wrapper.setProps({ keyRef: 'second' });
    await flushPromises();
    if (completion === 'resolve') pending.resolve(); else pending.reject(new Error('旧复制错误'));
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('第二把');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('真实回读本人详情，显示标识/归属/全部元数据并关联本人政策', async () => {
    const pending = deferred<KmsKey>();
    api.getMyKmsKey.mockReturnValueOnce(pending.promise);
    render();
    await nextTick();
    expect(wrapper.text()).toContain('正在读取密钥详情');
    pending.resolve(key);
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledWith('mine');
    expect(wrapper.get('.kms-facts').text()).toContain('iam:me');
    expect(wrapper.get('.kms-facts').text()).toContain('创建时间');
    expect(wrapper.get('.kms-facts').text()).toContain('最近更新');
    expect(wrapper.get('.kms-facts').text()).toContain('ES256');
    expect(wrapper.get('[aria-label="归属人销毁政策"]').text()).toContain('当前密钥');
    expect(wrapper.text()).toContain('名下的全部密钥');
    expect(wrapper.text()).toContain('最短提前量：1 小时；最长提前量：2 小时');
    await button('修改销毁政策').trigger('click');
    expect(wrapper.emitted('edit-policy')).toHaveLength(1);
    await wrapper.setProps({ policyRevision: 1 });
    await flushPromises();
    expect(api.loadMyDestructionPolicy).toHaveBeenCalledTimes(2);
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('治理详情也真实读取，沿授权归属读取政策但不可编辑他人政策', async () => {
    render({ keyRef: 'mine', mode: 'governance', initialKey: key });
    await flushPromises();
    expect(api.getAdminKmsKey).toHaveBeenCalledWith('mine');
    expect(api.getMyKmsKey).not.toHaveBeenCalled();
    expect(api.getOwnerDestructionPolicy).toHaveBeenCalledWith('iam:other');
    expect(wrapper.text()).toContain('iam:other');
    expect(wrapper.text()).not.toContain('修改销毁政策');
    await button('停用').trigger('click');
    await confirm();
    expect(api.changeKmsKeyState).toHaveBeenCalledWith('mine', 'DISABLED', 3, expect.any(String));
    expect(api.changeMyKmsKeyState).not.toHaveBeenCalled();
    expect(wrapper.get('.kms-facts').text()).toContain('iam:other');
  });

  it('在没有政策编辑表单的治理页面读取本人新密钥时隐藏修改入口', async () => {
    render({ keyRef: 'mine', mode: 'self', policyEditable: false });
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledWith('mine');
    expect(wrapper.text()).toContain('最短提前量：1 小时');
    expect(wrapper.text()).not.toContain('修改销毁政策');
  });

  it.each(['self', 'governance'] as const)('%s模式的五种生命周期动作固定选择入口并回读同模式详情与政策', async (mode) => {
    const manage = mode === 'self' ? api.changeMyKmsKeyState : api.changeKmsKeyState;
    const rotate = mode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    const schedule = mode === 'self' ? api.scheduleMyKmsDestruction : api.scheduleKmsDestruction;
    const cancel = mode === 'self' ? api.cancelMyKmsDestruction : api.cancelKmsDestruction;
    const getDetail = mode === 'self' ? api.getMyKmsKey : api.getAdminKmsKey;
    const getPolicy = mode === 'self' ? api.loadMyDestructionPolicy : api.getOwnerDestructionPolicy;
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    await button('停用').trigger('click');
    await confirm();
    expect(manage).toHaveBeenLastCalledWith(key.keyRef, 'DISABLED', 3, expect.any(String));
    expect(wrapper.get('.kms-facts').text()).toContain('DISABLED');
    await button('启用').trigger('click');
    await confirm();
    expect(manage).toHaveBeenLastCalledWith(key.keyRef, 'ACTIVE', 4, expect.any(String));
    await button('轮换').trigger('click');
    await confirm();
    expect(rotate).toHaveBeenCalledWith(key.keyRef, 4, expect.any(String));
    const due = new Date(Date.now() + 1.5 * 3600000);
    const local = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}T${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
    await wrapper.get('[aria-label="销毁时间"]').setValue(local);
    await button('安排销毁').trigger('click');
    await confirm();
    expect(schedule).toHaveBeenCalledWith(key.keyRef, due.toISOString(), 4, expect.any(String));
    getDetail.mockResolvedValue({ ...key, state: 'DISABLED', rowVersion: 5, ...(mode === 'governance' ? { ownerPrincipalId: 'iam:other' } : {}) });
    await button('取消销毁').trigger('click');
    await confirm();
    expect(cancel).toHaveBeenCalledWith(key.keyRef, 4, expect.any(String));
    expect(getDetail).toHaveBeenCalledTimes(6);
    expect(getPolicy).toHaveBeenCalledTimes(6);
    expect(wrapper.emitted('changed')).toHaveLength(5);
    const opposite = mode === 'self'
      ? [api.changeKmsKeyState, api.rotateKmsKey, api.scheduleKmsDestruction, api.cancelKmsDestruction, api.getAdminKmsKey]
      : [api.changeMyKmsKeyState, api.rotateMyKmsKey, api.scheduleMyKmsDestruction, api.cancelMyKmsDestruction, api.getMyKmsKey];
    for (const method of opposite) expect(method).not.toHaveBeenCalled();
  });

  it.each([
    ['self', 403], ['self', 404], ['governance', 403], ['governance', 404]
  ] as const)('%s模式收到%s时保留拒绝，不回退另一写入口', async (mode, status) => {
    const rotate = mode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    const opposite = mode === 'self' ? api.rotateKmsKey : api.rotateMyKmsKey;
    rotate.mockRejectedValueOnce(new api.KmsApiError(status, `拒绝${status}`));
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    await button('轮换').trigger('click');
    await confirm();
    expect(wrapper.get('[role="alertdialog"]').text()).toContain(`拒绝${status}`);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(opposite).not.toHaveBeenCalled();
    expect(wrapper.emitted('changed')).toBeUndefined();
  });

  it.each(['self', 'governance'] as const)('%s网络结果不明时重试保留同目标同版本同幂等键', async (mode) => {
    const rotate = mode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    rotate.mockRejectedValueOnce(new Error('网络结果不明'));
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    await button('轮换').trigger('click');
    await confirm();
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('网络结果不明');
    await confirm();
    expect(rotate.mock.calls[1]).toEqual(rotate.mock.calls[0]);
    expect(wrapper.get('.kms-facts').text()).toContain('3');
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it.each(['self', 'governance'] as const)('%s成功写入后的详情回读失败仍报告写成功，重读前不开放下一次写', async (mode) => {
    const getDetail = mode === 'self' ? api.getMyKmsKey : api.getAdminKmsKey;
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    getDetail.mockRejectedValueOnce(new Error('成功后的回读失败'));
    await button('轮换').trigger('click');
    await confirm();
    expect(wrapper.get('[role="status"]').text()).toBe('轮换成功。');
    expect(wrapper.get('[role="alert"]').text()).toContain('成功后的回读失败');
    expect(wrapper.find('.kms-key-lifecycle').exists()).toBe(false);
    expect(wrapper.emitted('changed')).toHaveLength(1);
    await button('重新读取详情').trigger('click');
    await flushPromises();
    expect(wrapper.find('.kms-key-lifecycle').exists()).toBe(true);
  });

  it.each([
    ['self', 'governance', 'resolve'], ['self', 'governance', 'reject'],
    ['governance', 'self', 'resolve'], ['governance', 'self', 'reject']
  ] as const)('%s写请求期间切换%s模式隔离旧%s结果，下一次动作使用新入口和新键', async (mode, nextMode, completion) => {
    const pending = deferred<KmsKey>();
    const rotate = mode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    const nextRotate = nextMode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    rotate.mockReturnValueOnce(pending.promise);
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    await button('轮换').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    await wrapper.setProps({ mode: nextMode });
    await flushPromises();
    if (completion === 'resolve') pending.resolve(key); else pending.reject(new Error('旧入口错误'));
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('旧入口错误');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(nextRotate).not.toHaveBeenCalled();
    await button('轮换').trigger('click');
    await confirm();
    expect(nextRotate).toHaveBeenCalledTimes(1);
    expect(nextRotate.mock.calls[0][2]).not.toBe(rotate.mock.calls[0][2]);
  });

  it.each(['resolve', 'reject'])('卸载详情后忽略生命周期%s结果且不启动成功回读', async (completion) => {
    const pending = deferred<KmsKey>();
    api.rotateMyKmsKey.mockReturnValueOnce(pending.promise);
    render();
    await flushPromises();
    await button('轮换').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    wrapper.unmount();
    if (completion === 'resolve') pending.resolve(key); else pending.reject(new Error('已卸载写错误'));
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('changed')).toBeUndefined();
  });

  it.each(['resolve', 'reject'])('切换密钥忽略旧详情%s结果', async (completion) => {
    const stale = deferred<KmsKey>();
    api.getMyKmsKey.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ ...key, keyRef: 'new', keyAlias: '新的密钥' });
    render();
    await wrapper.setProps({ keyRef: 'new' });
    await flushPromises();
    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧读取错误'));
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('新的密钥');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.kms-selected-detail').attributes('aria-busy')).toBe('false');
  });

  it.each(['resolve', 'reject'])('切换身份忽略旧本人详情%s，归属只取本次请求身份', async (completion) => {
    const stale = deferred<KmsKey>();
    const current = deferred<KmsKey>();
    api.getMyKmsKey.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    render();
    setKmsMe({ principalId: 'iam:next', subjectType: 'HUMAN', scopes: ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'], pagePermissions: ['kms.page.my-keys'] });
    await nextTick();

    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧身份读取错误'));
    await flushPromises();
    expect(wrapper.find('.kms-facts').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('旧身份读取错误');
    expect(api.loadMyDestructionPolicy).not.toHaveBeenCalled();

    current.resolve({ ...key, keyAlias: '新身份密钥' });
    await flushPromises();
    expect(wrapper.get('.kms-facts').text()).toContain('iam:next');
    expect(wrapper.get('h2').text()).toBe('新身份密钥');
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(2);
  });

  it('身份清除立即移除详情、公钥、政策及旧确认，恢复身份后需要重新确认', async () => {
    render({ keyRef: 'mine', initialKey: key });
    await flushPromises();
    await button('轮换').trigger('click');
    setKmsMe(null);
    await flushPromises();
    expect(wrapper.find('.kms-facts').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'KeyPublicKeys' }).exists()).toBe(false);
    expect(wrapper.find('[aria-label="归属人销毁政策"]').exists()).toBe(false);
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.get('h2').text()).toBe('密钥详情');
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(1);
    expect(api.rotateMyKmsKey).not.toHaveBeenCalled();

    setKmsMe({ principalId: 'iam:next', subjectType: 'HUMAN', scopes: ['kms.key.read', 'kms.key.manage'], pagePermissions: ['kms.page.my-keys'] });
    await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    await button('轮换').trigger('click');
    await confirm();
    expect(api.rotateMyKmsKey).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['self', 'resolve'], ['self', 'reject'], ['governance', 'resolve'], ['governance', 'reject']
  ] as const)('%s身份切换后旧写请求%s不会回读、提示或解除新操作提交态', async (mode, completion) => {
    const stale = deferred<KmsKey>();
    const current = deferred<KmsKey>();
    const rotate = mode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    const getDetail = mode === 'self' ? api.getMyKmsKey : api.getAdminKmsKey;
    rotate.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    await button('轮换').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    getDetail.mockResolvedValue({ ...key, keyAlias: '新身份详情', rowVersion: 8, ...(mode === 'governance' ? { ownerPrincipalId: 'iam:other' } : {}) });
    setKmsMe({ principalId: 'iam:next', subjectType: 'HUMAN', scopes: ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'], pagePermissions: ['kms.page.my-keys'] });
    await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    await button('轮换').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');

    if (completion === 'resolve') stale.resolve(key); else stale.reject(new Error('旧身份写错误'));
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('旧身份写错误');
    expect(getDetail).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[role="alertdialog"] .button-danger').attributes('disabled')).toBeDefined();
    expect(rotate.mock.calls[1][1]).toBe(8);
    expect(rotate.mock.calls[1][2]).not.toBe(rotate.mock.calls[0][2]);

    current.resolve({ ...key, rowVersion: 9 });
    await flushPromises();
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.get('[role="status"]').text()).toBe('轮换成功。');
  });

  it('详情读取失败不保留列表快照供写，重新读取成功再开放操作', async () => {
    api.getMyKmsKey.mockRejectedValueOnce(new Error('详情失败'));
    render({ keyRef: 'mine', initialKey: key });
    await flushPromises();
    expect(wrapper.text()).toContain('详情失败');
    expect(wrapper.find('.kms-facts').exists()).toBe(false);
    expect(wrapper.find('.kms-key-lifecycle').exists()).toBe(false);
    await button('重新读取详情').trigger('click');
    await flushPromises();
    expect(wrapper.find('.kms-facts').exists()).toBe(true);
  });

  it('非Error详情和政策失败均有兜底提示', async () => {
    api.getMyKmsKey.mockRejectedValueOnce(null);
    api.loadMyDestructionPolicy.mockRejectedValueOnce(null);
    render();
    await flushPromises();
    expect(wrapper.text()).toContain('读取密钥详情失败');
    await button('重新读取详情').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('读取归属人销毁政策失败');
  });

  it('只读权限或非本人结果不开放生命周期和政策写', async () => {
    kmsState.me!.scopes = [];
    render();
    await flushPromises();
    expect(wrapper.find('.kms-key-lifecycle').exists()).toBe(false);
    expect(wrapper.find('[aria-label="归属人销毁政策"]').exists()).toBe(false);
    expect(api.loadMyDestructionPolicy).not.toHaveBeenCalled();
    wrapper.unmount();
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'];
    api.getMyKmsKey.mockResolvedValue({ ...key, ownerPrincipalId: 'iam:other' });
    render({ keyRef: 'other' });
    await flushPromises();
    expect(wrapper.find('.kms-key-lifecycle').exists()).toBe(false);
    expect(api.loadMyDestructionPolicy).not.toHaveBeenCalled();
  });

  it('销毁政策回读失败阻止安排，重试和空窗口均正确关联', async () => {
    api.loadMyDestructionPolicy.mockRejectedValueOnce(new Error('窗口失败')).mockResolvedValueOnce({ ...policy, exists: false, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null });
    render();
    await flushPromises();
    expect(wrapper.text()).toContain('窗口失败');
    expect(button('安排销毁').attributes('disabled')).toBeDefined();
    await button('重试政策').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('最短提前量：不限制；最长提前量：不限制');
    await wrapper.get('[aria-label="销毁时间"]').setValue('2027-01-01T12:00');
    await button('安排销毁').trigger('click');
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('销毁全部版本');
  });

  it.each(['resolve', 'reject'])('政策修订回读忽略旧政策%s结果', async (completion) => {
    const stale = deferred<KmsOwnerDestructionPolicy>();
    api.loadMyDestructionPolicy.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ ...policy, minScheduleAheadSeconds: 0 });
    render();
    await flushPromises();
    expect(wrapper.text()).toContain('正在读取销毁政策');
    await wrapper.setProps({ policyRevision: 1 });
    await flushPromises();
    if (completion === 'resolve') stale.resolve(policy); else stale.reject(new Error('旧窗口错误'));
    await flushPromises();
    expect(wrapper.text()).toContain('最短提前量：0 小时');
    expect(wrapper.text()).not.toContain('旧窗口错误');
  });

  it.each(['停用', '启用', '轮换'])('%s仅确认后执行并使用回读版本', async (label) => {
    if (label === '启用') api.getMyKmsKey.mockResolvedValue({ ...key, state: 'DISABLED' });
    render();
    await flushPromises();
    await button(label).trigger('click');
    expect(api.changeMyKmsKeyState).not.toHaveBeenCalled();
    expect(api.rotateMyKmsKey).not.toHaveBeenCalled();
    await wrapper.get('[role="alertdialog"] .button-secondary').trigger('click');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    await button(label).trigger('click');
    await confirm();
    if (label === '轮换') expect(api.rotateMyKmsKey).toHaveBeenCalledWith('mine', 3, expect.any(String));
    else expect(api.changeMyKmsKeyState).toHaveBeenCalledWith('mine', label === '启用' ? 'ACTIVE' : 'DISABLED', 3, expect.any(String));
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.get('[role="status"]').text()).toBe(`${label}成功。`);
  });

  it('确认后权限撤销不发写请求', async () => {
    render();
    await flushPromises();
    await button('轮换').trigger('click');
    kmsState.me!.scopes = [];
    await confirm();
    expect(api.rotateMyKmsKey).not.toHaveBeenCalled();
  });

  it('提交中禁止关闭/重复执行，失败重试复用目标和幂等键', async () => {
    const pending = deferred<KmsKey>();
    api.rotateMyKmsKey.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(null);
    render();
    await flushPromises();
    await button('轮换').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    await wrapper.get('[role="alertdialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.get('.drawer-backdrop').trigger('click');
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    expect(api.rotateMyKmsKey).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.get('[role="alertdialog"] .button-secondary').attributes('disabled')).toBeDefined();
    pending.reject(new Error('连接中断'));
    await flushPromises();
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('连接中断');
    await confirm();
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('密钥操作失败，请重试');
    await confirm();
    const requests = api.rotateMyKmsKey.mock.calls;
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
  });

  it.each(['self', 'governance'] as const)('%s的409停止确认并重新读取，人工重新确认使用新版本', async (mode) => {
    const rotate = mode === 'self' ? api.rotateMyKmsKey : api.rotateKmsKey;
    const getDetail = mode === 'self' ? api.getMyKmsKey : api.getAdminKmsKey;
    rotate.mockRejectedValueOnce(new api.KmsApiError(409, '资源已被并发修改'));
    render({ keyRef: key.keyRef, mode });
    await flushPromises();
    await button('轮换').trigger('click');
    getDetail.mockResolvedValue({ ...key, rowVersion: 8, ...(mode === 'governance' ? { ownerPrincipalId: 'iam:other' } : {}) });
    await confirm();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('请核对重新读取的详情后重新确认操作');
    expect(getDetail).toHaveBeenCalledTimes(2);
    await button('轮换').trigger('click');
    await confirm();
    expect(rotate).toHaveBeenLastCalledWith('mine', 8, expect.any(String));
    expect(rotate.mock.calls[1][2]).not.toEqual(rotate.mock.calls[0][2]);
  });

  it('安排销毁校验未来及归属窗口，确认后使用固定时间快照', async () => {
    const local = (ahead: number) => {
      const date = new Date(Date.now() + ahead * 3600000);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };
    render();
    await flushPromises();
    for (const ahead of [-1, .5, 3]) {
      await wrapper.get('[aria-label="销毁时间"]').setValue(local(ahead));
      await button('安排销毁').trigger('click');
      expect(wrapper.text()).toContain('销毁时间需在未来');
      expect(api.scheduleMyKmsDestruction).not.toHaveBeenCalled();
    }
    await wrapper.get('[aria-label="销毁时间"]').setValue(local(1.5));
    await button('安排销毁').trigger('click');
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('不可恢复');
    await wrapper.get('[aria-label="销毁时间"]').setValue(local(1.75));
    await confirm();
    expect(api.scheduleMyKmsDestruction).toHaveBeenCalledWith('mine', new Date(Date.now() + 1.5 * 3600000).toISOString(), 3, expect.any(String));
    expect(wrapper.text()).toContain('仅后台从未领取过');
  });

  it('取消销毁需要确认，成功后重新读取真实状态', async () => {
    api.getMyKmsKey.mockResolvedValueOnce({ ...key, state: 'PENDING_DESTRUCTION', activeVersion: null }).mockResolvedValueOnce({ ...key, state: 'DISABLED' });
    render();
    await flushPromises();
    expect(button('停用').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.kms-facts').text()).toContain('-');
    await button('取消销毁').trigger('click');
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('从未领取过');
    await confirm();
    expect(api.cancelMyKmsDestruction).toHaveBeenCalledWith('mine', 3, expect.any(String));
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.kms-facts').text()).toContain('DISABLED');
  });

  it.each(['resolve', 'reject'])('写请求期间切换密钥忽略旧操作%s结果', async (completion) => {
    const pending = deferred<KmsKey>();
    api.rotateMyKmsKey.mockReturnValueOnce(pending.promise);
    render();
    await flushPromises();
    await button('轮换').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    api.getMyKmsKey.mockResolvedValue({ ...key, keyRef: 'second', keyAlias: '第二把' });
    await wrapper.setProps({ keyRef: 'second' });
    await flushPromises();
    if (completion === 'resolve') pending.resolve(key); else pending.reject(new Error('旧操作失败'));
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('第二把');
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('旧操作失败');
  });

  it('取消后回读期间切换密钥不将旧成功信息赋给新详情', async () => {
    const stale = deferred<KmsKey>();
    api.getMyKmsKey.mockResolvedValueOnce({ ...key, state: 'PENDING_DESTRUCTION' }).mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ ...key, keyRef: 'second', keyAlias: '第二把' });
    render();
    await flushPromises();
    await button('取消销毁').trigger('click');
    await wrapper.get('[role="alertdialog"] .button-danger').trigger('click');
    await flushPromises();
    await wrapper.setProps({ keyRef: 'second' });
    await flushPromises();
    stale.resolve(key);
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('第二把');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('复制标识成功及失败均给反馈，已销毁密钥无销毁入口', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('复制被拒绝')).mockRejectedValueOnce(null);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    api.getMyKmsKey.mockResolvedValue({ ...key, state: 'DESTROYED', purpose: 'ENCRYPT', algorithm: 'AES_256_GCM' });
    render();
    await flushPromises();
    await wrapper.get('[aria-label="复制密钥标识"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('mine');
    expect(wrapper.text()).toContain('密钥标识已复制');
    await wrapper.get('[aria-label="复制密钥标识"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('复制失败，请选中密钥标识复制');
    await wrapper.get('[aria-label="复制密钥标识"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('复制失败，请选中密钥标识复制');
    expect(wrapper.find('.kms-destruction-action').exists()).toBe(false);
    expect(wrapper.get('.kms-facts').text()).toContain('加解密（ENCRYPT）');
  });

  it('卸载后忽略未完成的详情和政策请求', async () => {
    const pending = deferred<KmsKey>();
    api.getMyKmsKey.mockReturnValueOnce(pending.promise);
    render();
    wrapper.unmount();
    pending.resolve(key);
    await flushPromises();
    expect(api.loadMyDestructionPolicy).not.toHaveBeenCalled();
    const policyPending = deferred<KmsOwnerDestructionPolicy>();
    api.loadMyDestructionPolicy.mockReturnValueOnce(policyPending.promise);
    render();
    await flushPromises();
    wrapper.unmount();
    policyPending.resolve(policy);
    await nextTick();
    await flushPromises();
  });
});
