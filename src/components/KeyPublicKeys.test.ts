import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KmsApiError, type KmsKey, type KmsPublicKey } from '../api/kmsApi';
import { kmsState } from '../kmsState';
import KeyPublicKeys from './KeyPublicKeys.vue';

const api = vi.hoisted(() => ({ listMyKmsPublicKeys: vi.fn() }));
vi.mock('../api/kmsApi', async importOriginal => ({ ...await importOriginal<typeof import('../api/kmsApi')>(), ...api }));

const key: KmsKey = {
  ownerPrincipalId: 'iam:owner', keyRef: 'key-1', keyAlias: '签名密钥', purpose: 'SIGN',
  algorithm: 'ES256', state: 'ACTIVE', activeVersion: 2, rowVersion: 3,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z'
};
const publicKeys: KmsPublicKey[] = [
  { keyRef: key.keyRef, version: 1, algorithm: 'ES256', state: 'RETIRED', publicKey: 'historical-key-base64url' },
  { keyRef: key.keyRef, version: 2, algorithm: 'ES256', state: 'ACTIVE', publicKey: 'active-key-base64url' }
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
let wrapper: VueWrapper;
const writeText = vi.fn();
async function chooseVersion(label: string) {
  await wrapper.get('button[aria-label="公钥版本"]').trigger('click');
  const option = wrapper.findAll('[role="option"]').find((node) => node.text() === label);
  expect(option).toBeDefined();
  await option!.trigger('click');
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
}
function publicKeyValue() {
  return (wrapper.get('textarea[aria-label="公钥值"]').element as HTMLTextAreaElement).value;
}

beforeEach(() => {
  vi.resetAllMocks();
  kmsState.me = { principalId: 'iam:owner', subjectType: 'HUMAN', scopes: ['kms.read-public-key'], pagePermissions: [] };
  api.listMyKmsPublicKeys.mockResolvedValue(publicKeys);
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => {
  wrapper?.unmount();
  kmsState.me = null;
  vi.unstubAllGlobals();
});

describe('密钥公钥详情', () => {
  it('本人普通账号无需策略管理权限或使用策略即可读公钥，403不引导创建策略', async () => {
    api.listMyKmsPublicKeys.mockRejectedValueOnce(new KmsApiError(403, '没有执行该操作的权限'));
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('当前账号仍有读取本人公钥的权限');
    expect(wrapper.text()).not.toContain('策略');
    expect(wrapper.find('a').exists()).toBe(false);
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(publicKeyValue()).toBe('active-key-base64url');
  });

  it('服务身份和用途不符时不调用本人公钥接口', async () => {
    kmsState.me!.subjectType = 'SERVICE';
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    expect(wrapper.text()).toContain('仅供人员身份使用');
    expect(api.listMyKmsPublicKeys).not.toHaveBeenCalled();
    kmsState.me!.subjectType = 'HUMAN';
    await wrapper.setProps({ keyInfo: { ...key, purpose: 'ENCRYPT' } });
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('不支持查看签名公钥');
  });

  it.each(['resolve', 'reject'])('A到B再回A时旧本人公钥%s不会覆盖当前读取', async completion => {
    const stale = deferred<KmsPublicKey[]>();
    api.listMyKmsPublicKeys.mockReturnValueOnce(stale.promise);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    kmsState.me!.principalId = 'iam:next';
    await nextTick();
    expect(wrapper.find('textarea').exists()).toBe(false);
    kmsState.me!.principalId = 'iam:owner';
    await flushPromises();
    if (completion === 'resolve') stale.resolve([{ ...publicKeys[0], publicKey: 'old-identity-value' }]);
    else stale.reject(new Error('旧身份错误'));
    await flushPromises();
    expect(publicKeyValue()).toBe('active-key-base64url');
    expect(wrapper.text()).not.toContain('旧身份错误');
  });
  it('自动读取可分发版本，默认活动版本，可切换历史版本并复制完整公钥', async () => {
    const pending = deferred<KmsPublicKey[]>();
    api.listMyKmsPublicKeys.mockReturnValueOnce(pending.promise);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    expect(api.listMyKmsPublicKeys).toHaveBeenCalledWith(key.keyRef);
    expect(wrapper.get('section[aria-label="公钥"]').attributes('aria-busy')).toBe('true');
    expect(wrapper.text()).toContain('正在读取公钥');
    pending.resolve(publicKeys);
    await flushPromises();
    expect(wrapper.get('button[aria-label="公钥版本"]').text()).toContain('版本 2 · 活动');
    expect(wrapper.text()).toContain('X.509 DER（Base64url，无填充）');
    expect(publicKeyValue()).toBe('active-key-base64url');
    expect(wrapper.get('textarea').attributes('readonly')).toBeDefined();
    await wrapper.get('button[aria-label="复制公钥"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('active-key-base64url');
    expect(wrapper.get('[role="status"]').text()).toBe('公钥已复制');
    await chooseVersion('版本 1 · 已退役');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(publicKeyValue()).toBe('historical-key-base64url');
    await wrapper.get('button[aria-label="复制公钥"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenLastCalledWith('historical-key-base64url');
  });

  it.each([
    [{ ...key, algorithm: 'AES_256_GCM' as const }, 'AES-256-GCM 是对称密钥'],
    [{ ...key, ownerPrincipalId: 'iam:other' }, '当前身份只能读取自身归属密钥的公钥'],
    [{ ...key, ownerPrincipalId: undefined }, '当前身份只能读取自身归属密钥的公钥'],
    [{ ...key, state: 'PENDING_DESTRUCTION' as const }, '待销毁或已销毁的密钥不再提供公钥'],
    [{ ...key, state: 'DESTROYED' as const }, '待销毁或已销毁的密钥不再提供公钥']
  ])('密钥不满足发布条件时不发送公钥请求', async (keyInfo, hint) => {
    wrapper = mount(KeyPublicKeys, { props: { keyInfo } });
    await flushPromises();
    expect(wrapper.text()).toContain(hint);
    expect(api.listMyKmsPublicKeys).not.toHaveBeenCalled();
    expect(wrapper.find('button[aria-label="公钥版本"]').exists()).toBe(false);
  });

  it('缺少API权限不读取，权限收回后立即清空已经显示的公钥', async () => {
    kmsState.me!.scopes = [];
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    expect(wrapper.text()).toContain('当前身份没有读取公钥的权限');
    expect(api.listMyKmsPublicKeys).not.toHaveBeenCalled();
    kmsState.me!.scopes = ['kms.read-public-key'];
    await flushPromises();
    expect(publicKeyValue()).toBe('active-key-base64url');
    kmsState.me!.scopes = [];
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('当前身份没有读取公钥的权限');
  });

  it('身份消失后清空公钥，停用密钥仍可读取，元数据或刷新版本变化后重新回读', async () => {
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: { ...key, state: 'DISABLED' } } });
    await flushPromises();
    expect(publicKeyValue()).toBe('active-key-base64url');
    await wrapper.setProps({ keyInfo: { ...key, state: 'DISABLED', rowVersion: 4 } });
    await flushPromises();
    await wrapper.setProps({ refreshRevision: 1 });
    await flushPromises();
    expect(api.listMyKmsPublicKeys).toHaveBeenCalledTimes(3);
    kmsState.me = null;
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('本人公钥查看仅供人员身份使用');
  });

  it('没有活动版本时选最高可分发版本，未知版本状态按原值展示，空列表显示空态', async () => {
    api.listMyKmsPublicKeys.mockResolvedValueOnce([{ ...publicKeys[0], version: 4, state: 'UNKNOWN' }])
      .mockResolvedValueOnce([]);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: { ...key, activeVersion: null } } });
    await flushPromises();
    expect(wrapper.get('button[aria-label="公钥版本"]').text()).toContain('版本 4 · UNKNOWN');
    expect(publicKeyValue()).toBe('historical-key-base64url');
    await wrapper.setProps({ keyInfo: { ...key, activeVersion: null, rowVersion: 4 } });
    await flushPromises();
    expect(wrapper.text()).toContain('暂无可分发的公钥版本');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it.each([new Error('读取公钥失败：没有执行该操作的权限'), 'unexpected failure'])('读取失败时显示可重试错误', async (error) => {
    api.listMyKmsPublicKeys.mockRejectedValueOnce(error);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('读取公钥失败');
    expect(wrapper.find('textarea').exists()).toBe(false);
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(publicKeyValue()).toBe('active-key-base64url');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it.each(['resolve', 'reject'])('切换密钥后忽略旧请求的%s结果', async (completion) => {
    const stale = deferred<KmsPublicKey[]>();
    const latest = deferred<KmsPublicKey[]>();
    api.listMyKmsPublicKeys.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await wrapper.setProps({ keyInfo: { ...key, keyRef: 'key-2' } });
    latest.resolve([{ ...publicKeys[1], keyRef: 'key-2', publicKey: 'latest-public-key' }]);
    await flushPromises();
    if (completion === 'resolve') stale.resolve(publicKeys);
    else stale.reject(new Error('旧公钥请求失败'));
    await flushPromises();
    expect(publicKeyValue()).toBe('latest-public-key');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('section').attributes('aria-busy')).toBe('false');
  });

  it.each(['resolve', 'reject'])('撤回权限或卸载后忽略未完成的%s公钥读取', async (completion) => {
    const pending = deferred<KmsPublicKey[]>();
    api.listMyKmsPublicKeys.mockReturnValueOnce(pending.promise);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    kmsState.me!.scopes = [];
    await nextTick();
    wrapper.unmount();
    if (completion === 'resolve') pending.resolve(publicKeys);
    else pending.reject(new Error('过期公钥请求失败'));
    await flushPromises();
    expect(api.listMyKmsPublicKeys).toHaveBeenCalledTimes(1);
  });

  it('复制期间阻止重复复制，换版本后丢弃过期成功提示', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValueOnce(pending.promise);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    const copyButton = wrapper.get('button[aria-label="复制公钥"]');
    await copyButton.trigger('click');
    expect(copyButton.attributes('disabled')).toBeDefined();
    await copyButton.trigger('click');
    expect(writeText).toHaveBeenCalledTimes(1);
    await chooseVersion('版本 1 · 已退役');
    pending.resolve(undefined);
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="复制公钥"]').attributes('disabled')).toBeUndefined();
  });

  it.each([new Error('剪贴板权限被拒绝'), 'unexpected failure'])('复制失败保留公钥值并支持重试', async (error) => {
    writeText.mockRejectedValueOnce(error);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    await wrapper.get('button[aria-label="复制公钥"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('复制公钥失败，请选中公钥值复制。');
    expect(publicKeyValue()).toBe('active-key-base64url');
    await wrapper.get('button[aria-label="复制公钥"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('公钥已复制');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('剪贴板不可用时显示选择复制提示，不丢弃完整公钥', async () => {
    vi.stubGlobal('navigator', {});
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    await wrapper.get('button[aria-label="复制公钥"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('复制公钥失败，请选中公钥值复制。');
    expect(publicKeyValue()).toBe('active-key-base64url');
  });

  it('卸载后不显示过期的剪贴板失败', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValueOnce(pending.promise);
    wrapper = mount(KeyPublicKeys, { props: { keyInfo: key } });
    await flushPromises();
    await wrapper.get('button[aria-label="复制公钥"]').trigger('click');
    wrapper.unmount();
    pending.reject(new Error('过期复制失败'));
    await flushPromises();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
