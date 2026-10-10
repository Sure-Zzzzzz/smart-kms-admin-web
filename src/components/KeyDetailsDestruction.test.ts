import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KmsKey, KmsKeyDestructionDetails } from '../api/kmsApi';
import { kmsState, setKmsMe } from '../kmsState';
import KeyDetails from './KeyDetails.vue';

const api = vi.hoisted(() => ({
  getMyKmsKey: vi.fn(), getAdminKmsKey: vi.fn(), getMyKmsDestruction: vi.fn(), getAdminKmsDestruction: vi.fn(),
  loadMyDestructionPolicy: vi.fn(), getOwnerDestructionPolicy: vi.fn(),
  changeMyKmsKeyState: vi.fn(), changeKmsKeyState: vi.fn(), rotateMyKmsKey: vi.fn(), rotateKmsKey: vi.fn(),
  scheduleMyKmsDestruction: vi.fn(), scheduleKmsDestruction: vi.fn(), cancelMyKmsDestruction: vi.fn(), cancelKmsDestruction: vi.fn(),
  KmsApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } }
}));
vi.mock('../api/kmsApi', () => api);
const pendingKey: KmsKey = {
  ownerPrincipalId: 'iam:me', keyRef: 'mine', keyAlias: '本人的待销毁密钥', algorithm: 'ES256', purpose: 'SIGN',
  state: 'PENDING_DESTRUCTION', activeVersion: null, rowVersion: 3,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z'
};
let current: KmsKey;
let cancelEligible: boolean;
function snapshot(): KmsKeyDestructionDetails {
  return { keyRef: current.keyRef, keyState: current.state, rowVersion: current.rowVersion, cancelEligible,
    items: current.state === 'PENDING_DESTRUCTION' ? [1, 2].map(keyVersion => ({ keyVersion, state: 'PENDING' as const,
      dueAt: '2026-11-01T00:00:00Z', completedAt: null })) : [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let wrapper: VueWrapper;
function render(mode: 'self' | 'governance' = 'self') {
  wrapper = mount(KeyDetails, { props: { keyRef: 'mine', initialKey: pendingKey, mode }, global: { stubs: { KeyPublicKeys: true } } });
}
function button(name: string) { return wrapper.findAll('button').find(node => node.text() === name)!; }
async function confirm() { await wrapper.get('[role="alertdialog"] footer button:not(.button-secondary)').trigger('click'); await flushPromises(); }
beforeEach(() => {
  vi.resetAllMocks();
  current = { ...pendingKey };
  cancelEligible = true;
  setKmsMe({ principalId: 'iam:me', subjectType: 'HUMAN', scopes: ['kms.key.read', 'kms.key.manage', 'kms.key.destroy'], pagePermissions: [] });
  api.getMyKmsKey.mockImplementation(() => Promise.resolve({ ...current }));
  api.getAdminKmsKey.mockImplementation(() => Promise.resolve({ ...current }));
  api.getMyKmsDestruction.mockImplementation(() => Promise.resolve(snapshot()));
  api.getAdminKmsDestruction.mockImplementation(() => Promise.resolve(snapshot()));
  api.loadMyDestructionPolicy.mockResolvedValue({ ownerPrincipalId: 'iam:me', exists: false, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null, rowVersion: 0 });
  api.getOwnerDestructionPolicy.mockResolvedValue({ ownerPrincipalId: 'iam:me', exists: false, minScheduleAheadSeconds: null, maxScheduleAheadSeconds: null, rowVersion: 0 });
  api.cancelMyKmsDestruction.mockImplementation(() => { current = { ...current, state: 'ACTIVE', activeVersion: 2, rowVersion: 4 }; cancelEligible = false; return Promise.resolve(); });
});
afterEach(() => { wrapper?.unmount(); setKmsMe(null); });

describe('销毁进度与状态恢复', () => {
  it('只有read权限也能看各版本排程和完成状态，没有政策或取消入口', async () => {
    kmsState.me!.scopes = ['kms.key.read'];
    api.getMyKmsDestruction.mockResolvedValue({ ...snapshot(), cancelEligible: false, items: [
      { keyVersion: 1, state: 'COMPLETED', dueAt: '2026-11-01T00:00:00Z', completedAt: '2026-11-01T01:00:00Z' },
      { keyVersion: 2, state: 'CLAIMED', dueAt: '2026-11-01T00:00:00Z', completedAt: null }
    ] });
    render();
    await flushPromises();
    const progress = wrapper.get('[aria-label="销毁进度"]');
    expect(progress.text()).toContain('已完成');
    expect(progress.text()).toContain('执行中');
    expect(progress.get('tbody').findAll('tr')).toHaveLength(2);
    expect(progress.text()).toContain('当前销毁任务已不能取消');
    expect(button('取消销毁')).toBeUndefined();
    expect(wrapper.find('[aria-label="归属人销毁政策"]').exists()).toBe(false);
    expect(api.loadMyDestructionPolicy).not.toHaveBeenCalled();
  });

  it.each(['self', 'governance'] as const)('%s先读取元数据后读取同模式明细，已领取后PENDING仍不可取消', async mode => {
    const metadata = deferred<KmsKey>();
    const getKey = mode === 'self' ? api.getMyKmsKey : api.getAdminKmsKey;
    const getProgress = mode === 'self' ? api.getMyKmsDestruction : api.getAdminKmsDestruction;
    getKey.mockReturnValueOnce(metadata.promise);
    cancelEligible = false;
    render(mode);
    expect(getProgress).not.toHaveBeenCalled();
    metadata.resolve(current);
    await flushPromises();
    expect(getProgress).toHaveBeenCalledWith('mine');
    expect(button('取消销毁')).toBeUndefined();
    expect(wrapper.text()).toContain('一旦被后台领取过');
    expect(mode === 'self' ? api.getAdminKmsDestruction : api.getMyKmsDestruction).not.toHaveBeenCalled();
  });

  it('快照失配自动重读整对一次，持续失配停止请求并人工重试', async () => {
    api.getMyKmsDestruction.mockResolvedValue({ ...snapshot(), rowVersion: 4 });
    render();
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(2);
    expect(api.getMyKmsDestruction).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('密钥状态与销毁详情已变化');
    expect(button('取消销毁')).toBeUndefined();
    api.getMyKmsDestruction.mockResolvedValue(snapshot());
    await button('重新读取详情').trigger('click');
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(3);
    expect(button('取消销毁')).toBeDefined();
  });

  it('第一次跨状态快照失配后，重新读取最新元数据和任务才恢复资格', async () => {
    const latest = { ...current, rowVersion: 4 };
    api.getMyKmsKey.mockResolvedValueOnce(current).mockResolvedValue(latest);
    api.getMyKmsDestruction.mockResolvedValue({ ...snapshot(), rowVersion: 4 });
    render();
    await flushPromises();
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(2);
    expect(button('取消销毁')).toBeDefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it.each([403, 404, 503])('明细%s不是无任务，不沿用取消资格，重试只读整对', async status => {
    api.getMyKmsDestruction.mockRejectedValueOnce(new api.KmsApiError(status, `明细${status}`));
    render();
    await flushPromises();
    expect(wrapper.get('[aria-label="销毁进度"]').text()).toContain(`明细${status}`);
    expect(wrapper.text()).not.toContain('暂无销毁任务');
    expect(button('取消销毁')).toBeUndefined();
    await button('重新读取销毁详情').trigger('click');
    await flushPromises();
    expect(button('取消销毁')).toBeDefined();
    expect(api.cancelMyKmsDestruction).not.toHaveBeenCalled();
    expect(api.getAdminKmsDestruction).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'])('同主体撤read后清标题和详情，恢复后旧明细%s不覆盖新快照', async completion => {
    const stale = deferred<KmsKeyDestructionDetails>();
    api.getMyKmsDestruction.mockReturnValueOnce(stale.promise);
    render();
    await flushPromises();
    kmsState.me!.scopes = ['kms.key.manage', 'kms.key.destroy'];
    await nextTick();
    expect(wrapper.get('h2').text()).toBe('密钥详情');
    expect(wrapper.find('.detail-list').exists()).toBe(false);
    expect(wrapper.find('[aria-label="销毁进度"]').exists()).toBe(false);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.destroy'];
    cancelEligible = false;
    await flushPromises();
    if (completion === 'resolve') stale.resolve({ ...snapshot(), cancelEligible: true });
    else stale.reject(new Error('旧read错误'));
    await flushPromises();
    expect(button('取消销毁')).toBeUndefined();
    expect(wrapper.text()).not.toContain('旧read错误');
    expect(wrapper.get('[aria-label="销毁进度"]').attributes('aria-busy')).toBe('false');
  });

  it('明确取消成功先通知列表，明细回读失败只重试GET，不重复执行取消', async () => {
    render();
    await flushPromises();
    api.getMyKmsDestruction.mockRejectedValueOnce(new Error('成功后的明细失败'));
    await button('取消销毁').trigger('click');
    await confirm();
    expect(wrapper.get('[role="status"]').text()).toBe('取消销毁成功。');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.get('[aria-label="销毁进度"]').text()).toContain('成功后的明细失败');
    await button('重新读取销毁详情').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('暂无销毁任务');
    expect(api.cancelMyKmsDestruction).toHaveBeenCalledTimes(1);
  });

  it('取消已执行但响应丢失，确认期间刷新禁用，原正文原键重放一次恢复', async () => {
    api.cancelMyKmsDestruction.mockImplementationOnce(() => {
      current = { ...current, state: 'ACTIVE', activeVersion: 2, rowVersion: 4 };
      cancelEligible = false;
      return Promise.reject(new Error('响应丢失'));
    }).mockResolvedValueOnce(undefined);
    render();
    await flushPromises();
    await button('取消销毁').trigger('click');
    await confirm();
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('响应丢失');
    expect(button('刷新销毁进度').attributes('disabled')).toBeDefined();
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(1);
    await confirm();
    expect(api.cancelMyKmsDestruction.mock.calls[1]).toEqual(api.cancelMyKmsDestruction.mock.calls[0]);
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.text()).toContain('暂无销毁任务');
  });

  it('同身份撤destroy清确认，旧取消结果不能解除恢复授权后的新提交态', async () => {
    const oldWrite = deferred<void>();
    const newWrite = deferred<void>();
    api.cancelMyKmsDestruction.mockReturnValueOnce(oldWrite.promise).mockReturnValueOnce(newWrite.promise);
    render();
    await flushPromises();
    await button('取消销毁').trigger('click');
    await wrapper.get('[role="alertdialog"] footer button:not(.button-secondary)').trigger('click');
    kmsState.me!.scopes = ['kms.key.read'];
    await nextTick();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="销毁进度"]').exists()).toBe(true);
    kmsState.me!.scopes = ['kms.key.read', 'kms.key.destroy'];
    await nextTick();
    await button('取消销毁').trigger('click');
    await wrapper.get('[role="alertdialog"] footer button:not(.button-secondary)').trigger('click');
    oldWrite.resolve();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.get('[role="alertdialog"] footer button:not(.button-secondary)').attributes('disabled')).toBeDefined();
    expect(api.cancelMyKmsDestruction.mock.calls[0][2]).not.toBe(api.cancelMyKmsDestruction.mock.calls[1][2]);
    current = { ...current, state: 'ACTIVE', rowVersion: 4 };
    cancelEligible = false;
    newWrite.resolve();
    await flushPromises();
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('取消409回读领取后的资格，停止确认且不自动再写', async () => {
    api.cancelMyKmsDestruction.mockImplementationOnce(() => { cancelEligible = false; return Promise.reject(new api.KmsApiError(409, '任务已领取')); });
    render();
    await flushPromises();
    await button('取消销毁').trigger('click');
    await confirm();
    expect(wrapper.text()).toContain('请核对重新读取的详情后重新确认操作');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(button('取消销毁')).toBeUndefined();
    expect(api.cancelMyKmsDestruction).toHaveBeenCalledTimes(1);
    expect(api.getMyKmsKey).toHaveBeenCalledTimes(2);
  });
});
