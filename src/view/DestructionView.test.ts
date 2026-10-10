import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import type { KmsDestructionJob, KmsPage, KmsWorkerHealth } from '../api/kmsApi';
import { kmsState, setKmsMe } from '../kmsState';
import DestructionView from './DestructionView.vue';

const api = vi.hoisted(() => ({ listKmsDestructionJobs: vi.fn(), loadKmsWorkerHealth: vi.fn() }));
vi.mock('../api/kmsApi', () => api);
let wrapper: VueWrapper;
const health: KmsWorkerHealth = {
  running: true, instanceId: 'worker-1', claimable: true, lastSuccessfulScanAt: '2026-01-01T12:00:00Z',
  consecutiveFailureCount: 0, oldestOverdueDelayMillis: null
};
const jobs: KmsDestructionJob[] = [
  { ownerPrincipalId: 'iam:1000000000000001', ownerDisplayName: '目录-展示用户', keyRef: 'key-1', keyVersion: 1, state: 'COMPLETED', dueAt: '2026-01-01T12:00:00Z', claimUntil: null, attemptCount: 2, completedAt: '2026-01-01T14:00:00Z' },
  { ownerPrincipalId: 'aksk:AKPPTEST0000000001', keyRef: 'key-2', keyVersion: 2, state: 'CLAIMED', dueAt: '2026-01-01T12:00:00Z', claimUntil: '2026-01-01T13:00:00Z', attemptCount: 1, completedAt: null },
  { keyRef: 'key-3', keyVersion: 1, state: 'PENDING', dueAt: '2026-01-01T12:00:00Z', claimUntil: null, attemptCount: 0, completedAt: null }
];
const page = (items: KmsDestructionJob[] = [], total = items.length): KmsPage<KmsDestructionJob> => ({ items, total, page: 1, size: 20 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function selectPage(value: number) {
  wrapper.getComponent(Pagination).vm.$emit('update:current', value);
}
function selectPageSize(value: number) {
  wrapper.getComponent(Pagination).vm.$emit('update:pageSize', value);
}

beforeEach(() => {
  vi.resetAllMocks();
  setKmsMe({ principalId: 'iam:owner', subjectType: 'HUMAN', scopes: ['kms.key.destroy'], pagePermissions: ['kms.page.destruction'] });
  api.listKmsDestructionJobs.mockResolvedValue(page());
  api.loadKmsWorkerHealth.mockResolvedValue(health);
});
afterEach(() => { wrapper?.unmount(); setKmsMe(null); });

describe('销毁任务页面', () => {
  it.each(['resolve', 'reject'])('切换身份忽略旧任务和Worker的%s结果，身份清除后不再查询', async completion => {
    const staleJobs = deferred<KmsPage<KmsDestructionJob>>();
    const staleHealth = deferred<KmsWorkerHealth>();
    const currentJobs = deferred<KmsPage<KmsDestructionJob>>();
    const currentHealth = deferred<KmsWorkerHealth>();
    api.listKmsDestructionJobs.mockReturnValueOnce(staleJobs.promise).mockReturnValueOnce(currentJobs.promise);
    api.loadKmsWorkerHealth.mockReturnValueOnce(staleHealth.promise).mockReturnValueOnce(currentHealth.promise);
    wrapper = mount(DestructionView);
    setKmsMe({ ...kmsState.me!, principalId: 'iam:next' });
    if (completion === 'resolve') { staleJobs.resolve(page(jobs)); staleHealth.resolve(health); }
    else { staleJobs.reject(new Error('旧任务错误')); staleHealth.reject(new Error('旧Worker错误')); }
    await flushPromises();
    expect(wrapper.get('tbody').text()).not.toContain('key-1');
    expect(wrapper.text()).not.toContain('旧任务错误');
    expect(wrapper.text()).not.toContain('旧Worker错误');
    expect(wrapper.text()).toContain('正在读取 Worker 状态');
    currentJobs.resolve(page([{ ...jobs[0], keyRef: 'next-key' }]));
    currentHealth.resolve({ ...health, running: false });
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('next-key');
    expect(wrapper.text()).toContain('Worker 未运行');
    setKmsMe(null);
    await flushPromises();
    expect(wrapper.text()).not.toContain('next-key');
    expect(wrapper.text()).toContain('暂未取得 Worker 状态');
    expect(api.listKmsDestructionJobs).toHaveBeenCalledTimes(2);
    expect(api.loadKmsWorkerHealth).toHaveBeenCalledTimes(2);
  });
  it('独立展示任务和Worker加载，不把未知状态显示为零失败', async () => {
    const readingJobs = deferred<KmsPage<KmsDestructionJob>>();
    const readingWorker = deferred<KmsWorkerHealth>();
    api.listKmsDestructionJobs.mockReturnValueOnce(readingJobs.promise);
    api.loadKmsWorkerHealth.mockReturnValueOnce(readingWorker.promise);
    wrapper = mount(DestructionView);
    await nextTick();
    expect(wrapper.text()).toContain('正在读取 Worker 状态');
    expect(wrapper.text()).toContain('连续失败：未取得');
    expect(wrapper.text()).not.toContain('连续失败：0');
    expect(wrapper.get('tbody td.data-table-placeholder').text()).toContain('加载中');
    readingJobs.resolve(page(jobs));
    await flushPromises();
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(wrapper.get('.kms-panel-heading').text()).toContain('任务列表 3');
    expect(wrapper.find('tbody td.data-table-placeholder').exists()).toBe(false);
    expect(wrapper.text()).toContain('正在读取 Worker 状态');
    readingWorker.resolve(health);
    await flushPromises();
    expect(wrapper.text()).toContain('Worker 正常运行');
    expect(wrapper.text()).toContain('连续失败：0');
    expect(api.listKmsDestructionJobs).toHaveBeenCalledWith(1, 20, undefined);
    expect(wrapper.findAll('.status-badge:not(.kms-owner-source)').map(node => node.classes())).toEqual([
      ['status-badge', 'success'], ['status-badge', 'warning'], ['status-badge', 'neutral']
    ]);
    expect(wrapper.findAll('.status-badge:not(.kms-owner-source)').map(node => node.text())).toEqual(['已完成', '处理中', '待处理']);
    expect(wrapper.findAll('.kms-owner-source').map(node => node.text())).toEqual(['平台人员', '服务凭证']);
    expect(wrapper.findAll('thead th').map(node => node.text())).toEqual([
      '归属主体', '密钥', '版本', '状态', '计划时间', '租约到期', '完成时间', '尝试次数'
    ]);
    expect(wrapper.findAll('tbody tr')[0].findAll('td')[5].text()).toBe('-');
    expect(wrapper.findAll('tbody tr')[0].findAll('td')[6].text()).toBe(new Date(jobs[0].completedAt!).toLocaleString());
    expect(wrapper.findAll('tbody tr')[0].findAll('td')[0].text()).toContain('目录-展示用户');
    expect(wrapper.findAll('tbody tr')[1].findAll('td')[0].text()).toContain('aksk:AKPPTEST0000000001');
    expect(wrapper.findAll('tbody tr')[1].findAll('td')[0].text()).toContain('服务凭证');
    expect(wrapper.findAll('tbody tr')[2].findAll('td')[0].text()).toBe('—');
    expect(Array.from(wrapper.get('.kms-list-panel').element.children).map(element => element.className)).toEqual([
      'kms-panel-heading', 'kms-filters', 'data-table-scroll', 'kms-pagination-row'
    ]);
  });

  it('归属筛选透传并回第一页，重置清空筛选并恢复默认页', async () => {
    api.listKmsDestructionJobs.mockResolvedValue(page(jobs, 60));
    wrapper = mount(DestructionView);
    await flushPromises();
    selectPage(2);
    await flushPromises();
    expect(api.listKmsDestructionJobs).toHaveBeenLastCalledWith(2, 20, undefined);
    await wrapper.get('input[aria-label="按归属筛选"]').setValue('iam:1000000000000001');
    await wrapper.get('form.kms-filters').trigger('submit');
    await flushPromises();
    expect(api.listKmsDestructionJobs).toHaveBeenLastCalledWith(1, 20, 'iam:1000000000000001');
    api.listKmsDestructionJobs.mockResolvedValueOnce({ items: [], total: 0, page: 1, size: 20 });
    await wrapper.get('input[aria-label="按归属筛选"]').setValue('iam:0000000000000009');
    await wrapper.get('form.kms-filters').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('当前筛选条件下没有销毁任务');
    const resetButton = wrapper.findAll('.kms-filter-actions button').find(button => button.text() === '重置');
    expect(resetButton).toBeDefined();
    await resetButton!.trigger('click');
    await flushPromises();
    expect(wrapper.get('input[aria-label="按归属筛选"]').element).toHaveProperty('value', '');
    expect(api.listKmsDestructionJobs).toHaveBeenLastCalledWith(1, 20, undefined);
    expect(wrapper.getComponent(Pagination).props('current')).toBe(1);
  });

  it('空列表展示零总数与空态，成功态没有刷新或重试按钮', async () => {
    wrapper = mount(DestructionView);
    await flushPromises();
    expect(wrapper.text()).toContain('当前没有销毁任务');
    expect(wrapper.get('.kms-panel-heading').text()).toBe('任务列表 0');
    expect(wrapper.findComponent(Pagination).exists()).toBe(false);
    expect(wrapper.find('button[aria-label="重试 Worker 状态"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="重试销毁任务"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('刷新');
  });

  it.each([
    [{ ...health, running: false }, 'Worker 未运行'],
    [{ ...health, claimable: false, lastSuccessfulScanAt: null, consecutiveFailureCount: 3 }, 'Worker 已暂停领取']
  ])('明确区分 Worker 状态', async (worker, summary) => {
    api.loadKmsWorkerHealth.mockResolvedValue(worker);
    wrapper = mount(DestructionView);
    await flushPromises();
    expect(wrapper.text()).toContain(summary);
    expect(wrapper.text()).toContain(`连续失败：${worker.consecutiveFailureCount}`);
  });

  it.each([new Error('健康读取失败'), 'unexpected error'])('Worker失败保留已经返回的任务，重试只重读Worker', async (error) => {
    api.loadKmsWorkerHealth.mockRejectedValueOnce(error);
    api.listKmsDestructionJobs.mockResolvedValue(page(jobs));
    wrapper = mount(DestructionView);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(error instanceof Error ? error.message : '读取 Worker 状态失败');
    expect(wrapper.text()).toContain('暂未取得 Worker 状态');
    expect(wrapper.text()).toContain('最近成功扫描：未取得 · 连续失败：未取得');
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    await wrapper.get('button[aria-label="重试 Worker 状态"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Worker 正常运行');
    expect(api.loadKmsWorkerHealth).toHaveBeenCalledTimes(2);
    expect(api.listKmsDestructionJobs).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('任务查询失败'), 'unexpected error'])('任务失败保留Worker状态，重试只重读任务', async (error) => {
    api.listKmsDestructionJobs.mockRejectedValueOnce(error).mockResolvedValueOnce(page(jobs));
    wrapper = mount(DestructionView);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(error instanceof Error ? error.message : '查询销毁任务失败');
    expect(wrapper.get('.kms-panel-heading').text()).toBe('任务列表');
    expect(wrapper.text()).not.toContain('当前没有销毁任务');
    expect(wrapper.text()).toContain('Worker 正常运行');
    await wrapper.get('button[aria-label="重试销毁任务"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(api.listKmsDestructionJobs).toHaveBeenCalledTimes(2);
    expect(api.loadKmsWorkerHealth).toHaveBeenCalledTimes(1);
  });

  it('两个请求均失败时分别提示，可以独立恢复', async () => {
    api.listKmsDestructionJobs.mockRejectedValueOnce(new Error('任务查询失败'));
    api.loadKmsWorkerHealth.mockRejectedValueOnce(new Error('健康读取失败'));
    wrapper = mount(DestructionView);
    await flushPromises();
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(2);
    await wrapper.get('button[aria-label="重试销毁任务"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    expect(wrapper.get('[role="alert"]').text()).toContain('健康读取失败');
    expect(wrapper.text()).toContain('当前没有销毁任务');
    await wrapper.get('button[aria-label="重试 Worker 状态"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('分页使用所选页码，默认每页20条且复用契约10/20/50/100选项，更换大小返回第一页', async () => {
    api.listKmsDestructionJobs.mockResolvedValue(page(jobs, 180));
    wrapper = mount(DestructionView);
    await flushPromises();
    expect(wrapper.getComponent(Pagination).props()).toMatchObject({ current: 1, total: 180, pageSize: 20 });
    await wrapper.get('button[aria-label="每页条数"]').trigger('click');
    expect(wrapper.findAll('[role="option"]').map(node => node.text())).toEqual([
      '10 条/页', '20 条/页', '50 条/页', '100 条/页'
    ]);
    await wrapper.findAll('[role="option"]').find(node => node.text() === '20 条/页')!.trigger('click');
    selectPage(3);
    await flushPromises();
    expect(api.listKmsDestructionJobs).toHaveBeenLastCalledWith(3, 20, undefined);
    expect(wrapper.getComponent(Pagination).props('current')).toBe(3);
    selectPageSize(50);
    await flushPromises();
    expect(api.listKmsDestructionJobs).toHaveBeenLastCalledWith(1, 50, undefined);
    selectPageSize(100);
    await flushPromises();
    expect(api.listKmsDestructionJobs).toHaveBeenLastCalledWith(1, 100, undefined);
    expect(wrapper.get('.kms-panel-heading').text()).toContain('任务列表 180');
    expect(api.loadKmsWorkerHealth).toHaveBeenCalledTimes(1);
  });

  it.each([[21, 2], [0, 1]])('任务总数缩减为%d时回到最后有效页%d后重新读取', async (total, lastPage) => {
    api.listKmsDestructionJobs.mockResolvedValueOnce(page(jobs, 80))
      .mockResolvedValueOnce(page([], total)).mockResolvedValueOnce(page(total ? jobs : [], total));
    wrapper = mount(DestructionView);
    await flushPromises();
    const pagination = wrapper.getComponent(Pagination);
    pagination.vm.$emit('update:current', 4);
    await flushPromises();
    expect(api.listKmsDestructionJobs.mock.calls.slice(-2)).toEqual([[4, 20, undefined], [lastPage, 20, undefined]]);
    if (total) {
      expect(wrapper.getComponent(Pagination).props('current')).toBe(lastPage);
      expect(wrapper.find('tbody td.data-table-placeholder').exists()).toBe(false);
    } else {
      expect(wrapper.findComponent(Pagination).exists()).toBe(false);
      expect(wrapper.get('.data-table-placeholder[role="status"]').text()).toContain('当前没有销毁任务');
    }
    expect(wrapper.get('.kms-panel-heading').text()).toContain(`任务列表 ${total}`);
  });

  it.each(['resolve', 'reject'])('连续翻页时忽略旧页的%s响应和加载状态', async (completion) => {
    const stale = deferred<KmsPage<KmsDestructionJob>>();
    const latest = deferred<KmsPage<KmsDestructionJob>>();
    api.listKmsDestructionJobs.mockResolvedValueOnce(page(jobs, 100))
      .mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    wrapper = mount(DestructionView);
    await flushPromises();
    selectPage(2);
    await nextTick();
    selectPage(3);
    await nextTick();
    latest.resolve(page([{ ...jobs[0], keyRef: 'latest-page-key' }], 100));
    await flushPromises();
    if (completion === 'resolve') stale.resolve(page([{ ...jobs[0], keyRef: 'old-page-key' }], 20));
    else stale.reject(new Error('过期翻页失败'));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('latest-page-key');
    expect(wrapper.get('tbody').text()).not.toContain('old-page-key');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.getComponent(Pagination).props()).toMatchObject({ current: 3, total: 100 });
    expect(wrapper.find('tbody td.data-table-placeholder').exists()).toBe(false);
  });

  it('快速连续重试Worker时旧响应不会覆盖新读取结果', async () => {
    const stale = deferred<KmsWorkerHealth>();
    const latest = deferred<KmsWorkerHealth>();
    api.loadKmsWorkerHealth.mockRejectedValueOnce(new Error('健康读取失败'))
      .mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    wrapper = mount(DestructionView);
    await flushPromises();
    const retryButton = wrapper.get('button[aria-label="重试 Worker 状态"]').element;
    retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    latest.resolve({ ...health, consecutiveFailureCount: 7 });
    await flushPromises();
    stale.resolve({ ...health, running: false });
    await flushPromises();
    expect(wrapper.text()).toContain('Worker 正常运行');
    expect(wrapper.text()).toContain('连续失败：7');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it.each(['resolve', 'reject'])('组件卸载后忽略任务和Worker的%s响应', async (completion) => {
    const readingJobs = deferred<KmsPage<KmsDestructionJob>>();
    const readingWorker = deferred<KmsWorkerHealth>();
    api.listKmsDestructionJobs.mockReturnValueOnce(readingJobs.promise);
    api.loadKmsWorkerHealth.mockReturnValueOnce(readingWorker.promise);
    wrapper = mount(DestructionView);
    wrapper.unmount();
    if (completion === 'resolve') {
      readingJobs.resolve(page(jobs));
      readingWorker.resolve(health);
    } else {
      readingJobs.reject(new Error('过期任务查询失败'));
      readingWorker.reject(new Error('过期Worker读取失败'));
    }
    await flushPromises();
    expect(api.listKmsDestructionJobs).toHaveBeenCalledTimes(1);
    expect(api.loadKmsWorkerHealth).toHaveBeenCalledTimes(1);
  });
});
