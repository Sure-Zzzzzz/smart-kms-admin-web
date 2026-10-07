import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KmsApiError, type KmsAdminPolicy, type KmsKey, type KmsPage } from '../api/kmsApi';
import { setKmsMe } from '../kmsState';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import PoliciesView from './PoliciesView.vue';

const api = vi.hoisted(() => ({
  listAdminKmsKeys: vi.fn(), listAdminKmsPolicies: vi.fn(), createKmsPolicy: vi.fn(), revokeKmsPolicy: vi.fn(), hasPermission: vi.fn()
}));
vi.mock('../api/kmsApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../api/kmsApi')>(), ...api }));
vi.mock('../kmsState', async importOriginal => ({ ...await importOriginal<typeof import('../kmsState')>(), hasKmsApiPermission: api.hasPermission }));
const key: KmsKey = {
  keyRef: 'key-1', keyAlias: '签名密钥', ownerPrincipalId: 'iam:owner', purpose: 'SIGN', algorithm: 'ES256', state: 'ACTIVE',
  activeVersion: 1, rowVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
};
const iamPolicy: KmsAdminPolicy = {
  policyId: 'policy-1', keyRef: 'key-1', keyAlias: '签名密钥', ownerPrincipalId: 'iam:1000000000000001',
  ownerDisplayName: '目录-展示用户', principalId: 'iam:2000000000000002', principalDisplayName: '目录-被授权方',
  keyVersion: null, operation: 'SIGN', expiresAt: null, rowVersion: 4, createdAt: '2026-01-02T00:00:00Z'
};
const akskPolicy: KmsAdminPolicy = {
  policyId: 'policy-2', keyRef: 'key-2', keyAlias: '加密密钥', ownerPrincipalId: 'aksk:AKPPTEST0000000001',
  principalId: 'aksk:AKPPTEST0000000002', keyVersion: 2, operation: 'DECRYPT',
  expiresAt: '2027-01-01T00:00:00Z', rowVersion: 7, createdAt: '2026-01-03T00:00:00Z'
};
const keyPage: KmsPage<KmsKey> = { items: [key], total: 1, page: 1, size: 100 };
function policyPage(items: KmsAdminPolicy[], total = items.length): KmsPage<KmsAdminPolicy> {
  return { items, total, page: 1, size: 100 };
}
let wrapper: VueWrapper;
async function clickButton(matcher: RegExp) {
  const button = wrapper.findAll('button').find(node => matcher.test(node.text() || ''));
  expect(button, 'button ' + matcher).toBeDefined();
  await button!.trigger('click');
}
async function choose(label: string, option: string) {
  await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
  const node = wrapper.findAll('[role="option"]').find(node => node.text() === option);
  expect(node).toBeDefined();
  await node!.trigger('click');
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
}
async function mountView() {
  wrapper = mount(PoliciesView);
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  vi.resetAllMocks();
  setKmsMe({ principalId: 'iam:owner', subjectType: 'HUMAN', scopes: ['kms.key.policy'], pagePermissions: ['kms.page.policies'] });
  api.hasPermission.mockReturnValue(true);
  api.listAdminKmsKeys.mockResolvedValue(keyPage);
  api.listAdminKmsPolicies.mockResolvedValue(policyPage([iamPolicy, akskPolicy]));
  api.createKmsPolicy.mockResolvedValue(iamPolicy);
  api.revokeKmsPolicy.mockResolvedValue(undefined);
});
afterEach(() => { wrapper?.unmount(); setKmsMe(null); });

describe('密钥策略页面', () => {
  it('全量策略列表展示密钥、双方主体显示名、版本与到期；密钥候选仅在打开创建弹窗时加载', async () => {
    await mountView();
    expect(api.listAdminKmsPolicies).toHaveBeenCalledWith(expect.objectContaining({ page: 1, size: 100 }));
    expect(api.listAdminKmsKeys).not.toHaveBeenCalled();
    const headers = wrapper.findAll('thead th').map(node => node.text());
    expect(headers).toEqual(['密钥', '归属主体', '被授权主体', '版本', '操作', '到期时间', '']);
    expect(wrapper.get('.kms-surface-header').text()).toContain('2 项');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    const first = rows[0].findAll('td').map(td => td.text());
    expect(first[0]).toContain('签名密钥');
    expect(first[1]).toContain('平台人员');
    expect(first[1]).toContain('目录-展示用户');
    expect(first[2]).toContain('目录-被授权方');
    expect(first[3]).toBe('全部');
    expect(first[4]).toBe('SIGN');
    expect(first[5]).toBe('长期有效');
    const second = rows[1].findAll('td').map(td => td.text());
    expect(second[1]).toContain('服务凭证');
    expect(second[1]).toContain('aksk:AKPPTEST0000000001');
    expect(second[2]).toContain('aksk:AKPPTEST0000000002');
    expect(second[3]).toBe('2');
    expect(second[5]).not.toBe('长期有效');
  });

  it('筛选条件透传到跨钥策略查询并刷新结果', async () => {
    await mountView();
    api.listAdminKmsPolicies.mockClear();
    await wrapper.get('input[aria-label="按密钥别名筛选"]').setValue('签名');
    await wrapper.get('input[aria-label="按被授权主体筛选"]').setValue('iam:2000000000000002');
    await choose('按操作筛选', '签名');
    await clickButton(/查询/);
    await flushPromises();
    expect(api.listAdminKmsPolicies).toHaveBeenCalledWith(expect.objectContaining({
      keyAlias: '签名', principalId: 'iam:2000000000000002', operation: 'SIGN', page: 1
    }));
  });

  it('策略分页翻页携带页码，筛选回第一页', async () => {
    api.listAdminKmsPolicies.mockResolvedValue(policyPage([iamPolicy], 250));
    await mountView();
    wrapper.findComponent(Pagination).vm.$emit('update:current', 2);
    await flushPromises();
    expect(api.listAdminKmsPolicies).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    wrapper.findComponent(Pagination).vm.$emit('update:pageSize', 20);
    await flushPromises();
    expect(api.listAdminKmsPolicies).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 20 }));
  });

  it('创建策略：点按钮弹窗、查找并选择密钥、校验参数、成功后刷新列表并提示', async () => {
    await mountView();
    await clickButton(/创建策略/);
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('创建策略');
    expect(api.listAdminKmsKeys).toHaveBeenCalledWith(expect.objectContaining({ page: 1, size: 100 }));
    api.listAdminKmsKeys.mockClear();
    await wrapper.get('input[aria-label="按别名查找密钥"]').setValue('签名');
    await clickButton(/查找/);
    await flushPromises();
    expect(api.listAdminKmsKeys).toHaveBeenCalledWith(expect.objectContaining({ alias: '签名' }));
    await choose('选择密钥', '签名密钥 · iam:owner · key-1');
    await wrapper.get('form.kms-form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('策略参数无效');
    await wrapper.get('form.kms-form input[placeholder^="iam:"]').setValue('iam:3000000000000003');
    api.listAdminKmsPolicies.mockClear();
    await wrapper.get('form.kms-form').trigger('submit');
    await flushPromises();
    expect(api.createKmsPolicy).toHaveBeenCalledWith('key-1', expect.objectContaining({ principalId: 'iam:3000000000000003', operation: 'SIGN' }), expect.any(String));
    expect(api.listAdminKmsPolicies).toHaveBeenCalled();
    expect(wrapper.text()).toContain('策略已创建。');
  });

  it('撤销策略经确认执行并刷新列表，409 冲突重新读取列表', async () => {
    await mountView();
    await wrapper.findAll('tbody tr')[1].get('button[aria-label="撤销策略"]').trigger('click');
    const dialog = wrapper.findComponent(Dialog);
    expect(dialog.props('open')).toBe(true);
    expect(dialog.props('description')).toContain('key-2');
    api.listAdminKmsPolicies.mockClear();
    await dialog.vm.$emit('confirm');
    await flushPromises();
    expect(api.revokeKmsPolicy).toHaveBeenCalledWith('key-2', 'policy-2', 7, expect.any(String));
    expect(api.listAdminKmsPolicies).toHaveBeenCalled();
    expect(wrapper.text()).toContain('策略已撤销。');
    api.revokeKmsPolicy.mockRejectedValue(new KmsApiError(409, '冲突'));
    await wrapper.findAll('tbody tr')[1].get('button[aria-label="撤销策略"]').trigger('click');
    const conflictDialog = wrapper.findComponent(Dialog);
    api.listAdminKmsPolicies.mockClear();
    await conflictDialog.vm.$emit('confirm');
    await flushPromises();
    expect(api.listAdminKmsPolicies).toHaveBeenCalled();
    expect(wrapper.text()).toContain('重新确认撤销');
  });

  it('身份切换清空列表与未提交表单，重新按第一页加载', async () => {
    await mountView();
    setKmsMe({ principalId: 'iam:next', subjectType: 'HUMAN', scopes: ['kms.key.policy'], pagePermissions: ['kms.page.policies'] });
    await flushPromises();
    expect(wrapper.get('.kms-surface-header').text()).toContain('0 项');
    expect(wrapper.findAll('tbody tr').length).toBeGreaterThanOrEqual(1);
    expect(api.listAdminKmsPolicies).toHaveBeenCalled();
  });

  it('策略列表加载失败显示错误并可重试恢复', async () => {
    api.listAdminKmsPolicies.mockRejectedValueOnce(new Error('网关超时'));
    await mountView();
    expect(wrapper.get('[role="alert"]').text()).toContain('网关超时');
    await wrapper.get('.kms-retry-button').trigger('click');
    await flushPromises();
    expect(api.listAdminKmsPolicies).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.kms-surface-header').text()).toContain('2 项');
  });

  it('查找密钥失败只在创建弹窗提示，不影响已有策略列表', async () => {
    await mountView();
    await clickButton(/创建策略/);
    await flushPromises();
    api.listAdminKmsKeys.mockRejectedValueOnce(new Error('密钥服务不可用'));
    await wrapper.get('input[aria-label="按别名查找密钥"]').setValue('任意');
    await clickButton(/查找/);
    await flushPromises();
    expect(wrapper.text()).toContain('密钥服务不可用');
    expect(wrapper.get('.kms-surface-header').text()).toContain('2 项');
  });

  it('查找无匹配密钥时弹窗内提示换别名，选择器保持占位', async () => {
    await mountView();
    await clickButton(/创建策略/);
    await flushPromises();
    api.listAdminKmsKeys.mockResolvedValueOnce({ items: [], total: 0, page: 1, size: 100 });
    await wrapper.get('input[aria-label="按别名查找密钥"]').setValue('不存在的别名');
    await clickButton(/查找/);
    await flushPromises();
    expect(wrapper.text()).toContain('没有匹配的密钥，换个别名再查找。');
    expect(wrapper.get('button[aria-label="选择密钥"]').text()).toContain('选择密钥');
  });

  it('撤销确认被关闭时不执行撤销', async () => {
    await mountView();
    await wrapper.findAll('tbody tr')[0].get('button[aria-label="撤销策略"]').trigger('click');
    const dialog = wrapper.findComponent(Dialog);
    dialog.vm.$emit('close');
    await flushPromises();
    expect(api.revokeKmsPolicy).not.toHaveBeenCalled();
  });

  it('没有策略 API 权限时显示无权空态且不创建策略面板', async () => {
    api.hasPermission.mockReturnValue(false);
    await mountView();
    expect(api.listAdminKmsPolicies).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前身份没有读取策略的权限');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
});
