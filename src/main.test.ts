import type { KmsMe, KmsMountProps } from './kmsState';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RouteTarget = { path: string; fullPath: string };
type Lifecycle = { bootstrap(): void; mount(props: unknown): void; update(props: unknown): void; unmount(): void };
type Preference = { mode: string; contractVersion: number };

const runtime = vi.hoisted(() => ({
  qiankun: { __POWERED_BY_QIANKUN__: true },
  lifecycle: undefined as Lifecycle | undefined,
  guard: undefined as ((to: RouteTarget) => Promise<unknown>) | undefined,
  mounted: undefined as Element | undefined,
  createApp: vi.fn(),
  createRouter: vi.fn(),
  createWebHistory: vi.fn(),
  use: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
  applyTheme: vi.fn(),
  loadMe: vi.fn(),
  beginAuthorization: vi.fn(),
  getAccessToken: vi.fn()
}));

vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), createApp: runtime.createApp }));
vi.mock('vue-router', () => ({ createRouter: runtime.createRouter, createWebHistory: runtime.createWebHistory }));
vi.mock('vite-plugin-qiankun/dist/helper', () => ({
  qiankunWindow: runtime.qiankun,
  renderWithQiankun: (lifecycle: Lifecycle) => { runtime.lifecycle = lifecycle; }
}));
vi.mock('@sure-zzzzzz/simple-iam-theme-contract', () => ({
  createLightThemePreference: () => ({ mode: 'light', contractVersion: 1 }),
  applyTheme: runtime.applyTheme
}));
vi.mock('./auth/pkce', () => ({ beginKmsAuthorization: runtime.beginAuthorization, getKmsAccessToken: runtime.getAccessToken }));
vi.mock('./api/kmsApi', () => ({
  loadKmsMe: runtime.loadMe,
  KmsApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } }
}));
vi.mock('./App.vue', () => ({ default: {} }));
vi.mock('./view/KeysView.vue', () => ({ default: {} }));
vi.mock('./view/MyKeysView.vue', () => ({ default: {} }));
vi.mock('./view/PoliciesView.vue', () => ({ default: {} }));
vi.mock('./view/DestructionView.vue', () => ({ default: {} }));
vi.mock('./view/ForbiddenView.vue', () => ({ default: {} }));
vi.mock('./view/OAuthCallbackView.vue', () => ({ default: {} }));
vi.mock('./view/StandaloneGuideView.vue', () => ({ default: {} }));

const me: KmsMe = { principalId: 'iam:user:1', subjectType: 'HUMAN', scopes: [], pagePermissions: ['kms.page.my-keys'] };

function themeSource(initial: Preference) {
  const listeners = new Set<(value: Preference) => void>();
  const release = vi.fn();
  return {
    release,
    current: () => initial,
    subscribe: vi.fn((listener: (value: Preference) => void) => {
      listeners.add(listener);
      return () => { release(); listeners.delete(listener); };
    }),
    emit(value: Preference) { listeners.forEach(listener => listener(value)); }
  };
}

async function start(props?: Omit<KmsMountProps, 'theme'> & { container?: Element | Document; routePrefix?: string; theme?: unknown }) {
  await import('./main');
  runtime.lifecycle?.bootstrap();
  if (props) runtime.lifecycle?.mount(props);
  return await import('./kmsState');
}

function navigate(path: string, fullPath = path) {
  if (!runtime.guard) throw new Error('route guard was not registered');
  return runtime.guard({ path, fullPath });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

describe('KMS qiankun lifecycle and route boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtime.qiankun.__POWERED_BY_QIANKUN__ = true;
    vi.stubGlobal('__POWERED_BY_QIANKUN__', true);
    runtime.lifecycle = undefined;
    runtime.guard = undefined;
    runtime.mounted = undefined;
    document.body.innerHTML = '<div id="portal"><div id="app"></div></div>';
    const app = { use: runtime.use, mount: runtime.mount, unmount: runtime.unmount };
    runtime.createApp.mockReturnValue(app);
    runtime.use.mockReturnValue(app);
    runtime.mount.mockImplementation((root: Element) => {
      runtime.mounted = root;
      root.innerHTML = '<section class="kms-admin-app"></section>';
    });
    runtime.unmount.mockImplementation(() => { if (runtime.mounted) runtime.mounted.innerHTML = ''; });
    runtime.createWebHistory.mockImplementation((base: string) => ({ base }));
    runtime.createRouter.mockImplementation(() => ({ beforeEach: (guard: (to: RouteTarget) => Promise<unknown>) => { runtime.guard = guard; } }));
    runtime.applyTheme.mockImplementation((root: HTMLElement, preference: Preference) => { root.dataset.theme = preference.mode; });
    runtime.loadMe.mockResolvedValue(me);
    runtime.beginAuthorization.mockResolvedValue(undefined);
    runtime.getAccessToken.mockReturnValue('current-token');
  });

  afterEach(() => {
    runtime.lifecycle?.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('mounts inside the supplied portal container with host context and route prefix', async () => {
    const container = document.querySelector('#portal') as Element;
    const user = { userId: 1, username: 'alice', displayName: 'Alice' };
    const state = await start({ container, routePrefix: '/tenant/kms', apiBase: '/gateway/kms/', getCurrentUser: () => user });
    expect(runtime.createWebHistory).toHaveBeenCalledWith('/tenant/kms/');
    expect(runtime.mounted).toBe(container.querySelector('#app'));
    expect(state.kmsState.currentUser).toEqual(user);
    expect(state.kmsState.apiBase).toBe('/gateway/kms');
    expect(container.querySelector<HTMLElement>('.kms-admin-app')?.dataset.theme).toBe('light');
    const config = runtime.createRouter.mock.lastCall?.[0] as { routes: { path: string; redirect?: string }[] };
    expect(config.routes.map(route => route.path)).toEqual(['/', '/keys', '/my-keys', '/policies', '/destruction', '/oauth-callback', '/403', '/:pathMatch(.*)*']);
    expect(config.routes.at(-1)?.redirect).toBe('/');
  }, 15000);

  it('automatically renders standalone and redirects protected pages to its guide', async () => {
    runtime.qiankun.__POWERED_BY_QIANKUN__ = false;
    vi.stubGlobal('__POWERED_BY_QIANKUN__', false);
    const state = await start();
    expect(runtime.createWebHistory).toHaveBeenCalledWith('/app/kms/');
    expect(document.querySelector('.kms-admin-app')).not.toBeNull();
    expect(state.kmsState.bridge).toBeNull();
    expect(await navigate('/')).toBe(true);
    expect(await navigate('/keys')).toBe('/');
    expect(runtime.loadMe).not.toHaveBeenCalled();
  });

  it('bypasses permission loading for authorization callback and denied access pages', async () => {
    await start({});
    expect(await navigate('/oauth-callback', '/oauth-callback?code=code&state=state')).toBe(true);
    expect(await navigate('/403')).toBe(true);
    expect(runtime.loadMe).not.toHaveBeenCalled();
  });

  it.each([
    ['/my-keys', 'kms.page.my-keys'], ['/keys', 'kms.page.keys'],
    ['/policies', 'kms.page.policies'], ['/destruction', 'kms.page.destruction']
  ])('requires the exact PAGE permission for %s', async (path, permission) => {
    const state = await start({});
    runtime.loadMe.mockResolvedValue({ ...me, pagePermissions: [permission], scopes: [] });
    expect(await navigate(path)).toBe(true);
    expect(state.kmsState.me?.pagePermissions).toEqual([permission]);
    expect(state.kmsState.meLoaded).toBe(true);
    runtime.loadMe.mockResolvedValue({ ...me, pagePermissions: [], scopes: ['kms.key.manage'] });
    expect(await navigate(path)).toBe('/403');
  });

  it.each([
    [['kms.page.my-keys', 'kms.page.keys'], '/my-keys'],
    [['kms.page.keys'], '/keys'], [['kms.page.policies'], '/policies'],
    [['kms.page.destruction'], '/destruction'], [[], '/403']
  ])('selects the first reachable root route for permissions %j', async (permissions, expected) => {
    await start({});
    runtime.loadMe.mockResolvedValue({ ...me, pagePermissions: permissions });
    expect(await navigate('/')).toBe(expected);
  });

  it('starts reauthorization for the full protected target when the resource server rejects the token', async () => {
    const state = await start({});
    expect(await navigate('/my-keys')).toBe(true);
    const { KmsApiError } = await import('./api/kmsApi');
    runtime.loadMe.mockRejectedValue(new KmsApiError(401, 'expired'));
    expect(await navigate('/keys', '/keys?purpose=SIGN')).toBe(false);
    const signal = runtime.loadMe.mock.lastCall?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(runtime.beginAuthorization).toHaveBeenCalledWith('/keys?purpose=SIGN', signal);
    expect(state.kmsState.me).toBeNull();
    expect(state.kmsState.meLoaded).toBe(false);
  });

  it.each(['recent authorization is suppressed', 'authorization fails'])('denies access and clears cached permissions when %s', async reason => {
    const state = await start({});
    expect(await navigate('/my-keys')).toBe(true);
    const { KmsApiError } = await import('./api/kmsApi');
    runtime.loadMe.mockRejectedValueOnce(new KmsApiError(401, 'expired'));
    runtime.beginAuthorization.mockRejectedValueOnce(new Error(reason));
    await expect(navigate('/keys')).resolves.toBe('/403');
    expect(state.kmsState.me).toBeNull();
    expect(state.kmsState.meLoaded).toBe(false);
  });

  it('invalidates cached permissions before waiting for reauthorization', async () => {
    const state = await start({});
    expect(await navigate('/my-keys')).toBe(true);
    const { KmsApiError } = await import('./api/kmsApi');
    const authorization = deferred<void>();
    runtime.loadMe.mockRejectedValueOnce(new KmsApiError(401, 'expired'));
    runtime.beginAuthorization.mockReturnValueOnce(authorization.promise);
    const navigation = navigate('/keys');
    await vi.waitFor(() => expect(runtime.beginAuthorization).toHaveBeenCalledOnce());
    expect(state.kmsState.me).toBeNull();
    expect(state.kmsState.meLoaded).toBe(false);
    authorization.resolve();
    expect(await navigation).toBe(false);
  });

  it('ignores an authorization failure after a newer navigation restores permissions', async () => {
    const state = await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const authorization = deferred<void>();
    runtime.loadMe.mockRejectedValueOnce(new KmsApiError(401, 'expired'));
    runtime.beginAuthorization.mockReturnValueOnce(authorization.promise);
    const earlier = navigate('/keys');
    await vi.waitFor(() => expect(runtime.beginAuthorization).toHaveBeenCalledOnce());
    expect(await navigate('/my-keys')).toBe(true);
    authorization.reject(new Error('authorization failed'));
    expect(await earlier).toBe(false);
    expect(state.kmsState.me).toEqual(me);
  });

  it('does not redirect or clear a new identity when earlier authorization fails', async () => {
    const state = await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const authorization = deferred<void>();
    runtime.loadMe.mockRejectedValueOnce(new KmsApiError(401, 'expired'));
    runtime.beginAuthorization.mockReturnValueOnce(authorization.promise);
    const earlier = navigate('/keys');
    await vi.waitFor(() => expect(runtime.beginAuthorization).toHaveBeenCalledOnce());
    const currentMe = { ...me, principalId: 'iam:user:2' };
    runtime.getAccessToken.mockReturnValue('new-token');
    state.setKmsMe(currentMe);
    authorization.reject(new Error('authorization failed'));
    expect(await earlier).toBe(false);
    expect(state.kmsState.me).toEqual(currentMe);
    expect(state.kmsState.meLoaded).toBe(true);
  });

  it('cancels pending permission loading and ignores a successful response after unmount', async () => {
    const state = await start({});
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const navigation = navigate('/my-keys');
    const signal = runtime.loadMe.mock.lastCall?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    runtime.lifecycle?.unmount();
    expect(signal.aborted).toBe(true);
    response.resolve(me);
    expect(await navigation).toBe(false);
    expect(state.kmsState.me).toBeNull();
    expect(state.kmsState.meLoaded).toBe(false);
    expect(runtime.beginAuthorization).not.toHaveBeenCalled();
  });

  it('does not start authorization for a delayed 401 after unmount', async () => {
    const state = await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const navigation = navigate('/keys');
    runtime.lifecycle?.unmount();
    response.reject(new KmsApiError(401, 'expired'));
    expect(await navigation).toBe(false);
    expect(runtime.beginAuthorization).not.toHaveBeenCalled();
    expect(state.kmsState.me).toBeNull();
  });

  it('does not let an earlier mount overwrite the identity of a new mount', async () => {
    const state = await start({});
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const oldGuard = runtime.guard!;
    const navigation = oldGuard({ path: '/my-keys', fullPath: '/my-keys' });
    runtime.lifecycle?.unmount();
    runtime.lifecycle?.mount({});
    const currentMe = { ...me, principalId: 'iam:user:2', pagePermissions: ['kms.page.keys'] };
    runtime.loadMe.mockResolvedValueOnce(currentMe);
    expect(await navigate('/keys')).toBe(true);
    response.resolve(me);
    expect(await navigation).toBe(false);
    expect(await oldGuard({ path: '/keys', fullPath: '/keys' })).toBe(false);
    expect(state.kmsState.me).toEqual(currentMe);
    expect(runtime.beginAuthorization).not.toHaveBeenCalled();
  });

  it('cancels authorization already in progress when its mount is removed', async () => {
    await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const authorization = deferred<void>();
    runtime.loadMe.mockRejectedValueOnce(new KmsApiError(401, 'expired'));
    runtime.beginAuthorization.mockReturnValueOnce(authorization.promise);
    const navigation = navigate('/keys');
    await vi.waitFor(() => expect(runtime.beginAuthorization).toHaveBeenCalledOnce());
    const signal = runtime.beginAuthorization.mock.lastCall?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    runtime.lifecycle?.unmount();
    expect(signal.aborted).toBe(true);
    authorization.reject(new DOMException('Aborted', 'AbortError'));
    expect(await navigation).toBe(false);
  });

  it('ignores an earlier permission result when a newer navigation completes first', async () => {
    const state = await start({});
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const earlier = navigate('/my-keys');
    const earlierSignal = runtime.loadMe.mock.lastCall?.[0] as AbortSignal;
    const currentMe = { ...me, pagePermissions: ['kms.page.keys'] };
    runtime.loadMe.mockResolvedValueOnce(currentMe);
    expect(await navigate('/keys')).toBe(true);
    expect(earlierSignal.aborted).toBe(true);
    response.resolve(me);
    expect(await earlier).toBe(false);
    expect(state.kmsState.me).toEqual(currentMe);
  });

  it('does not authorize an earlier navigation after a newer navigation completes', async () => {
    await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const earlier = navigate('/keys');
    expect(await navigate('/my-keys')).toBe(true);
    response.reject(new KmsApiError(401, 'expired'));
    expect(await earlier).toBe(false);
    expect(runtime.beginAuthorization).not.toHaveBeenCalled();
  });

  it.each(['success', 'unauthorized'] as const)('ignores a delayed %s response after credentials change', async outcome => {
    const state = await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const navigation = navigate('/my-keys');
    runtime.getAccessToken.mockReturnValue('new-token');
    const currentMe = { ...me, principalId: 'iam:user:2' };
    state.setKmsMe(currentMe);
    if (outcome === 'success') response.resolve(me);
    else response.reject(new KmsApiError(401, 'expired'));
    expect(await navigation).toBe(false);
    expect(state.kmsState.me).toEqual(currentMe);
    expect(state.kmsState.meLoaded).toBe(true);
    expect(runtime.beginAuthorization).not.toHaveBeenCalled();
  });

  it('authorizes a current 401 after the API clears its rejected token', async () => {
    await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    const response = deferred<KmsMe>();
    runtime.loadMe.mockReturnValueOnce(response.promise);
    const navigation = navigate('/keys');
    runtime.getAccessToken.mockReturnValue(null);
    response.reject(new KmsApiError(401, 'expired'));
    expect(await navigation).toBe(false);
    expect(runtime.beginAuthorization).toHaveBeenCalledOnce();
  });

  it('denies navigation for resource errors without initiating an authorization loop', async () => {
    const state = await start({});
    const { KmsApiError } = await import('./api/kmsApi');
    for (const error of [new KmsApiError(403, 'forbidden'), new Error('network failure')]) {
      state.setKmsMe(me);
      runtime.loadMe.mockRejectedValue(error);
      expect(await navigate('/keys')).toBe('/403');
      expect(state.kmsState.me).toBeNull();
      expect(state.kmsState.meLoaded).toBe(false);
    }
    expect(runtime.beginAuthorization).not.toHaveBeenCalled();
  });

  it('replaces host theme subscriptions and releases them together with identity on unmount', async () => {
    const theme = themeSource({ mode: 'dark', contractVersion: 1 });
    const replacement = themeSource({ mode: 'custom', contractVersion: 1 });
    const state = await start({ theme });
    const root = document.querySelector<HTMLElement>('.kms-admin-app') as HTMLElement;
    expect(root.dataset.theme).toBe('dark');
    theme.emit({ mode: 'light', contractVersion: 1 });
    expect(root.dataset.theme).toBe('light');
    runtime.lifecycle?.update({ theme: replacement, apiBase: '/new/kms' });
    expect(theme.release).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('custom');
    theme.emit({ mode: 'dark', contractVersion: 1 });
    expect(root.dataset.theme).toBe('custom');
    replacement.emit({ mode: 'dark', contractVersion: 1 });
    expect(root.dataset.theme).toBe('dark');
    expect(state.kmsState.apiBase).toBe('/new/kms');
    state.setKmsMe(me);
    runtime.lifecycle?.unmount();
    expect(replacement.release).toHaveBeenCalledOnce();
    expect(document.querySelector('.kms-admin-app')).toBeNull();
    expect(state.kmsState.me).toBeNull();
    expect(state.kmsState.meLoaded).toBe(false);
    expect(state.kmsState.bridge).toBeNull();
    expect(state.kmsState.apiBase).toBe('');
    runtime.lifecycle?.mount({});
    expect(document.querySelector<HTMLElement>('.kms-admin-app')?.dataset.theme).toBe('light');
  });

  it('stops listening to a removed host theme while preserving the current appearance', async () => {
    const theme = themeSource({ mode: 'dark', contractVersion: 1 });
    await start({ theme });
    const root = document.querySelector<HTMLElement>('.kms-admin-app') as HTMLElement;
    runtime.lifecycle?.update({});
    expect(theme.release).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('dark');
    theme.emit({ mode: 'custom', contractVersion: 1 });
    expect(root.dataset.theme).toBe('dark');
  });

  it('falls back to the document container and tolerates missing app roots', async () => {
    const emptyContainer = document.createElement('div');
    await start({ container: emptyContainer });
    expect(runtime.mounted).toBe(document.querySelector('#app'));
    document.body.innerHTML = '';
    runtime.mount.mockClear();
    runtime.applyTheme.mockClear();
    runtime.lifecycle?.mount({ container: emptyContainer });
    runtime.lifecycle?.update({ container: emptyContainer });
    expect(runtime.mount).not.toHaveBeenCalled();
    expect(runtime.applyTheme).not.toHaveBeenCalled();
  });

  it('does not assume a Vue application always renders the themed root', async () => {
    runtime.mount.mockImplementation(() => undefined);
    await start({});
    runtime.lifecycle?.update({});
    expect(runtime.applyTheme).not.toHaveBeenCalled();
    expect(document.querySelector('.kms-admin-app')).toBeNull();
  });
});
