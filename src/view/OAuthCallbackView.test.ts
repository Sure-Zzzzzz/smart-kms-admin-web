import { createApp, nextTick, type App as VueApp } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthCallbackView from './OAuthCallbackView.vue';

const callback = vi.hoisted(() => ({ handle: vi.fn(), replace: vi.fn(), isFailure: vi.fn() }));
vi.mock('../auth/pkce', () => ({ handleKmsOAuthCallback: callback.handle }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: callback.replace }), isNavigationFailure: callback.isFailure }));

let app: VueApp | undefined;
let root: HTMLElement;
const assign = vi.fn();

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  await nextTick();
}

async function mountCallback() {
  app = createApp(OAuthCallbackView);
  app.mount(root);
  await settle();
}

describe('KMS OAuth callback feedback and navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    callback.replace.mockResolvedValue(undefined);
    callback.isFailure.mockReturnValue(false);
    callback.handle.mockResolvedValue({ kind: 'authorized', target: '/my-keys' });
    vi.stubGlobal('window', {
      location: { assign }, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout
    });
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    root.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows authorization progress before the asynchronous callback settles', async () => {
    let resolve: ((value: { kind: string }) => void) | undefined;
    callback.handle.mockReturnValue(new Promise(resolver => { resolve = resolver; }));
    await mountCallback();
    expect(root.querySelector('h2')?.textContent).toBe('正在校验授权');
    expect(callback.replace).not.toHaveBeenCalled();
    resolve?.({ kind: 'retrying' });
    await settle();
    expect(root.querySelector('h2')?.textContent).toBe('授权校验未通过，正在重新发起授权…');
    expect(assign).not.toHaveBeenCalled();
  });

  it('navigates an authorized target and clears its navigation timeout', async () => {
    callback.handle.mockResolvedValue({ kind: 'authorized', target: '/keys?purpose=SIGN' });
    await mountCallback();
    expect(callback.replace).toHaveBeenCalledWith('/keys?purpose=SIGN');
    expect(root.querySelector('h2')?.textContent).toBe('授权成功，正在进入…');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(assign).not.toHaveBeenCalled();
  });

  it('provides a clear incomplete callback error without trying to enter a protected page', async () => {
    callback.handle.mockResolvedValue({ kind: 'missing-params' });
    await mountCallback();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('授权回调参数不完整，请从统一应用门户重新进入。');
    expect(root.querySelector('h2')).toBeNull();
    expect(root.querySelector('a')).toBeNull();
    expect(callback.replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([new Error('令牌交换失败'), 'unknown failure'])('offers a safe retry destination after callback failure %s', async failure => {
    callback.handle.mockRejectedValue(failure);
    await mountCallback();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(failure instanceof Error ? failure.message : '授权失败。');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/app/kms/');
    expect(root.querySelector('a')?.textContent).toBe('重试进入');
    expect(callback.replace).not.toHaveBeenCalled();
  });

  it('uses an entire-page destination when Vue Router reports a cancelled navigation', async () => {
    const navigationFailure = { type: 8 };
    callback.replace.mockResolvedValue(navigationFailure);
    callback.isFailure.mockImplementation(value => value === navigationFailure);
    await mountCallback();
    expect(callback.isFailure).toHaveBeenCalledWith(navigationFailure);
    expect(assign).toHaveBeenCalledWith('/app/kms/my-keys');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the same destination if router navigation rejects', async () => {
    callback.replace.mockRejectedValue(new Error('navigation failed'));
    await mountCallback();
    expect(assign).toHaveBeenCalledWith('/app/kms/my-keys');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back after exactly three seconds if router navigation never settles', async () => {
    callback.replace.mockReturnValue(new Promise(() => undefined));
    await mountCallback();
    expect(root.querySelector('h2')?.textContent).toBe('授权成功，正在进入…');
    await vi.advanceTimersByTimeAsync(2999);
    expect(assign).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(assign).toHaveBeenCalledWith('/app/kms/my-keys');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not begin navigation when authorization completes after the callback has unmounted', async () => {
    let resolve: ((value: { kind: string; target: string }) => void) | undefined;
    callback.handle.mockReturnValue(new Promise(resolver => { resolve = resolver; }));
    await mountCallback();
    const signal = callback.handle.mock.lastCall?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    app?.unmount();
    app = undefined;
    expect(signal.aborted).toBe(true);
    resolve?.({ kind: 'authorized', target: '/my-keys' });
    await settle();
    expect(callback.replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an authorization error that arrives after the callback has unmounted', async () => {
    let reject: ((error: Error) => void) | undefined;
    callback.handle.mockReturnValue(new Promise((_resolve, rejecter) => { reject = rejecter; }));
    await mountCallback();
    app?.unmount();
    app = undefined;
    reject?.(new Error('old authorization failed'));
    await settle();
    expect(callback.replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignores cancelled navigation completed after unmount instead of taking over the new application', async () => {
    const navigationFailure = { type: 8 };
    let resolve: ((value: typeof navigationFailure) => void) | undefined;
    callback.replace.mockReturnValue(new Promise(resolver => { resolve = resolver; }));
    callback.isFailure.mockImplementation(value => value === navigationFailure);
    await mountCallback();
    expect(callback.replace).toHaveBeenCalledWith('/my-keys');
    expect(vi.getTimerCount()).toBe(1);
    app?.unmount();
    app = undefined;
    expect(vi.getTimerCount()).toBe(0);
    resolve?.(navigationFailure);
    await settle();
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores a navigation rejection that arrives after the callback has unmounted', async () => {
    let reject: ((error: Error) => void) | undefined;
    callback.replace.mockReturnValue(new Promise((_resolve, rejecter) => { reject = rejecter; }));
    await mountCallback();
    app?.unmount();
    app = undefined;
    reject?.(new Error('old navigation cancelled'));
    await settle();
    expect(assign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the fallback timer on unmount even when navigation never settles', async () => {
    callback.replace.mockReturnValue(new Promise(() => undefined));
    await mountCallback();
    expect(vi.getTimerCount()).toBe(1);
    app?.unmount();
    app = undefined;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(assign).not.toHaveBeenCalled();
  });
});
