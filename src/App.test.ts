import { createApp, nextTick, type App as VueApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { applyKmsBridge, setKmsMe } from './kmsState';

let app: VueApp | undefined;
let root: HTMLElement;

async function mountApp() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div data-testid="route-content">Route content</div>' } }] });
  await router.push('/my-keys');
  app = createApp(App);
  app.use(router).mount(root);
  await nextTick();
}

describe('KMS application shell', () => {
  beforeEach(() => {
    vi.stubGlobal('__POWERED_BY_QIANKUN__', false);
    applyKmsBridge();
    setKmsMe(null);
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    root.remove();
    setKmsMe(null);
    applyKmsBridge();
    vi.unstubAllGlobals();
  });

  it('shows only authorized standalone navigation entries and reacts to permission changes', async () => {
    setKmsMe({ principalId: 'iam:user:1', subjectType: 'HUMAN', scopes: ['kms.key.manage'], pagePermissions: ['kms.page.my-keys', 'kms.page.policies'] });
    await mountApp();
    expect(root.querySelector('.kms-admin-app--standalone')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('密钥管理');
    expect(Array.from(root.querySelectorAll('nav a')).map(link => link.textContent?.trim())).toEqual(['我的密钥', '策略']);
    expect(Array.from(root.querySelectorAll('nav a')).map(link => link.getAttribute('href'))).toEqual(['/my-keys', '/policies']);
    expect(root.querySelector('[data-testid="route-content"]')?.textContent).toBe('Route content');
    setKmsMe({ principalId: 'iam:user:1', subjectType: 'HUMAN', scopes: [], pagePermissions: ['kms.page.keys', 'kms.page.destruction'] });
    await nextTick();
    expect(Array.from(root.querySelectorAll('nav a')).map(link => link.textContent?.trim())).toEqual(['密钥管理', '销毁任务']);
    setKmsMe(null);
    await nextTick();
    expect(root.querySelectorAll('nav a')).toHaveLength(0);
  });

  it('renders the route content without a duplicate shell inside the portal', async () => {
    applyKmsBridge({ getCurrentUser: () => ({ userId: 1, username: 'alice', displayName: null }) });
    setKmsMe({ principalId: 'iam:user:1', subjectType: 'HUMAN', scopes: [], pagePermissions: ['kms.page.keys'] });
    await mountApp();
    expect(root.querySelector('.kms-admin-app--standalone')).toBeNull();
    expect(root.querySelector('header')).toBeNull();
    expect(root.querySelector('nav')).toBeNull();
    expect(root.querySelector('[data-testid="route-content"]')?.textContent).toBe('Route content');
  });
});
