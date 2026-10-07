import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginKmsAuthorization, clearKmsAccessToken, getKmsAccessToken, handleKmsOAuthCallback, KmsPkceError } from './pkce';

const now = new Date('2026-10-05T04:00:00Z').getTime();
const storage = window.sessionStorage;
const fetchMock = vi.fn();
const assign = vi.fn();
const location = { origin: 'http://localhost:5178', search: '', assign };

function callbackState(value: unknown = { verifier: 'verifier-1', target: '/my-keys' }) {
  location.search = '?code=code%2Fone&state=state-1';
  storage.setItem('kms.pkce.state-1', JSON.stringify(value));
}

function tokenResponse(payload: unknown = { access_token: 'kms-token', expires_in: 120 }) {
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
}

describe('KMS PKCE authorization', () => {
  beforeEach(() => {
    storage.clear();
    fetchMock.mockReset();
    assign.mockReset();
    location.search = '';
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv('VITE_KMS_PKCE_CLIENT_ID', 'kms-client');
    vi.stubEnv('BASE_URL', '/app/kms/');
    vi.stubGlobal('crypto', webcrypto as unknown as Crypto);
    vi.stubGlobal('window', { sessionStorage: storage, location, fetch: fetchMock });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('generates a random state and SHA-256 challenge without exposing the verifier in the URL', async () => {
    await beginKmsAuthorization('/keys?purpose=SIGN');
    const url = new URL(assign.mock.lastCall?.[0] as string, location.origin);
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('kms-client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5178/app/kms/oauth-callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = JSON.parse(storage.getItem(`kms.pkce.${state}`) as string) as { verifier: string; target: string };
    expect(stored.target).toBe('/keys?purpose=SIGN');
    expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.verifier).not.toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(stored.verifier).digest('base64url'));
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(storage.getItem('kms.accessToken')).toBeNull();
  });

  it('defaults authorization to the root and rejects an unconfigured client', async () => {
    await beginKmsAuthorization();
    const url = new URL(assign.mock.lastCall?.[0] as string, location.origin);
    const state = url.searchParams.get('state');
    expect(JSON.parse(storage.getItem(`kms.pkce.${state}`) as string).target).toBe('/');
    assign.mockClear();
    vi.stubEnv('VITE_KMS_PKCE_CLIENT_ID', '');
    await expect(beginKmsAuthorization('/my-keys')).rejects.toMatchObject({ name: 'KmsPkceError', message: '未配置 VITE_KMS_PKCE_CLIENT_ID，无法发起授权' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('exchanges a one-use state, persists the token deadline and clears retry state', async () => {
    callbackState();
    storage.setItem('kms.pkce.retry', '1');
    storage.setItem('portal.accessToken', 'portal-token');
    tokenResponse();
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'authorized', target: '/my-keys' });
    expect(fetchMock).toHaveBeenCalledWith('/oauth2/token', expect.objectContaining({
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }));
    const request = fetchMock.mock.lastCall?.[1] as RequestInit;
    expect(Object.fromEntries(new URLSearchParams(request.body as string))).toEqual({
      grant_type: 'authorization_code', code: 'code/one', redirect_uri: 'http://127.0.0.1:5178/app/kms/oauth-callback',
      client_id: 'kms-client', code_verifier: 'verifier-1'
    });
    expect(storage.getItem('kms.pkce.state-1')).toBeNull();
    expect(storage.getItem('kms.pkce.retry')).toBeNull();
    expect(storage.getItem('kms.accessTokenExpiresAt')).toBe(String(now + 120_000));
    expect(storage.getItem('kms.lastAuthAt')).toBe(String(now));
    expect(getKmsAccessToken()).toBe('kms-token');
    clearKmsAccessToken();
    expect(getKmsAccessToken()).toBeNull();
    expect(storage.getItem('kms.accessTokenExpiresAt')).toBeNull();
    expect(storage.getItem('portal.accessToken')).toBe('portal-token');
  });

  it('uses the default token lifetime only when expires_in is absent', async () => {
    callbackState({ verifier: 'valid-verifier' });
    tokenResponse({ access_token: 'kms-token' });
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'authorized', target: '/' });
    expect(storage.getItem('kms.accessTokenExpiresAt')).toBe(String(now + 3_600_000));
  });

  it.each([undefined, 42, 'https://outside.example', '//outside.example/path', '/\\outside.example', 'relative'])('rejects unsafe callback return target %s', async target => {
    callbackState({ verifier: 'valid-verifier', target });
    tokenResponse();
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'authorized', target: '/' });
  });

  it.each(['/keys?purpose=SIGN', '/my-keys', '/'])('preserves local callback return target %s', async target => {
    callbackState({ verifier: 'valid-verifier', target });
    tokenResponse();
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'authorized', target });
  });

  it.each(['', '?code=one', '?state=state-1'])('does not exchange incomplete callback parameters %s', async search => {
    location.search = search;
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'missing-params' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('reports an OAuth denial before token exchange', async () => {
    location.search = '?error=access_denied&code=ignored&state=ignored';
    await expect(handleKmsOAuthCallback()).rejects.toEqual(new KmsPkceError('授权失败：access_denied'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(['missing', 'malformed', 'invalid-verifier'])('retries a %s state once without sending a token request', async kind => {
    location.search = '?code=one&state=state-1';
    if (kind === 'malformed') storage.setItem('kms.pkce.state-1', '{bad');
    if (kind === 'invalid-verifier') storage.setItem('kms.pkce.state-1', JSON.stringify({ verifier: 99, target: '/keys' }));
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'retrying' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.getItem('kms.pkce.state-1')).toBeNull();
    expect(storage.getItem('kms.pkce.retry')).toBe('1');
    const retryUrl = new URL(assign.mock.lastCall?.[0] as string, location.origin);
    const nextState = retryUrl.searchParams.get('state');
    expect(nextState).not.toBe('state-1');
    expect(JSON.parse(storage.getItem(`kms.pkce.${nextState}`) as string).target).toBe(kind === 'invalid-verifier' ? '/keys' : '/');
  });

  it('bounds failed token exchanges to one authorization retry', async () => {
    callbackState();
    fetchMock.mockResolvedValue({ ok: false });
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'retrying' });
    expect(storage.getItem('kms.pkce.retry')).toBe('1');
    callbackState();
    assign.mockClear();
    await expect(handleKmsOAuthCallback()).rejects.toMatchObject({ name: 'KmsPkceError', message: '令牌交换失败，请重新从统一应用门户进入' });
    expect(storage.getItem('kms.pkce.retry')).toBeNull();
    expect(storage.getItem('kms.accessToken')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    null, 'invalid', {}, { access_token: '' }, { access_token: '   ' }, { access_token: 42 },
    { access_token: 'token', expires_in: 0 }, { access_token: 'token', expires_in: -1 },
    { access_token: 'token', expires_in: '120' }, { access_token: 'token', expires_in: null },
    { access_token: 'token', expires_in: Number.NaN }, { access_token: 'token', expires_in: Number.POSITIVE_INFINITY },
    { access_token: 'token', expires_in: Number.MAX_VALUE }
  ])('does not persist an invalid token response %j', async payload => {
    callbackState();
    tokenResponse(payload);
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'retrying' });
    expect(storage.getItem('kms.accessToken')).toBeNull();
    expect(storage.getItem('kms.accessTokenExpiresAt')).toBeNull();
  });

  it('propagates exchange transport and parse errors without persisting a token', async () => {
    callbackState();
    const networkError = new Error('network disconnected');
    fetchMock.mockRejectedValue(networkError);
    await expect(handleKmsOAuthCallback()).rejects.toBe(networkError);
    expect(storage.getItem('kms.pkce.state-1')).toBeNull();
    callbackState();
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('invalid JSON')) });
    await expect(handleKmsOAuthCallback()).rejects.toBeInstanceOf(SyntaxError);
    expect(storage.getItem('kms.accessToken')).toBeNull();
  });

  it('does not retry a failed exchange after its callback has been cancelled', async () => {
    callbackState();
    const controller = new AbortController();
    let resolve: ((response: { ok: boolean }) => void) | undefined;
    fetchMock.mockReturnValue(new Promise(resolver => { resolve = resolver; }));
    const pending = handleKmsOAuthCallback(controller.signal);
    expect(fetchMock.mock.lastCall?.[1].signal).toBe(controller.signal);
    controller.abort();
    resolve?.({ ok: false });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(assign).not.toHaveBeenCalled();
    expect(storage.getItem('kms.pkce.retry')).toBeNull();
  });

  it('does not persist a late token when cancellation occurs during response parsing', async () => {
    callbackState();
    const controller = new AbortController();
    let resolve: ((payload: unknown) => void) | undefined;
    const parsing = new Promise(resolver => { resolve = resolver; });
    const json = vi.fn(() => parsing);
    fetchMock.mockResolvedValue({ ok: true, json });
    const pending = handleKmsOAuthCallback(controller.signal);
    await Promise.resolve();
    expect(json).toHaveBeenCalled();
    controller.abort();
    resolve?.({ access_token: 'late-token', expires_in: 120 });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(storage.getItem('kms.accessToken')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('cancels authorization before navigation even while its challenge is being generated', async () => {
    const controller = new AbortController();
    let resolve: ((digest: ArrayBuffer) => void) | undefined;
    vi.spyOn(webcrypto.subtle, 'digest').mockReturnValue(new Promise(resolver => { resolve = resolver; }));
    const pending = beginKmsAuthorization('/my-keys', controller.signal);
    controller.abort();
    resolve?.(new ArrayBuffer(32));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(assign).not.toHaveBeenCalled();
    await expect(beginKmsAuthorization('/', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(handleKmsOAuthCallback(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'new-token'], ['previous-token', 'new-token'], ['previous-token', null]
  ])('does not navigate when token changes from %s to %s during challenge generation', async (initialToken, currentToken) => {
    if (initialToken !== null) {
      storage.setItem('kms.accessToken', initialToken);
      storage.setItem('kms.accessTokenExpiresAt', String(now + 120_000));
    }
    let resolve: ((digest: ArrayBuffer) => void) | undefined;
    vi.spyOn(webcrypto.subtle, 'digest').mockReturnValue(new Promise(resolver => { resolve = resolver; }));
    const pending = beginKmsAuthorization('/my-keys');
    if (currentToken !== null) {
      storage.setItem('kms.accessToken', currentToken);
      storage.setItem('kms.accessTokenExpiresAt', String(now + 120_000));
    } else {
      clearKmsAccessToken();
    }
    resolve?.(new ArrayBuffer(32));
    await pending;
    expect(assign).not.toHaveBeenCalled();
    expect(getKmsAccessToken()).toBe(currentToken);
  });

  it.each([null, '', 'invalid', String(now), String(now - 1), 'Infinity'])('clears a token with missing, damaged or expired deadline %s', expiry => {
    storage.setItem('kms.accessToken', 'kms-token');
    if (expiry !== null) storage.setItem('kms.accessTokenExpiresAt', expiry);
    expect(getKmsAccessToken()).toBeNull();
    expect(storage.getItem('kms.accessToken')).toBeNull();
    expect(storage.getItem('kms.accessTokenExpiresAt')).toBeNull();
  });

  it('accepts a token until its exact expiration and rejects an empty token', () => {
    storage.setItem('kms.accessToken', 'kms-token');
    storage.setItem('kms.accessTokenExpiresAt', String(now + 1));
    expect(getKmsAccessToken()).toBe('kms-token');
    vi.setSystemTime(now + 1);
    expect(getKmsAccessToken()).toBeNull();
    storage.setItem('kms.accessToken', '   ');
    storage.setItem('kms.accessTokenExpiresAt', String(now + 10_000));
    expect(getKmsAccessToken()).toBeNull();
  });

  it('prevents a reauthorization loop after successful exchange but permits the interval boundary', async () => {
    callbackState();
    tokenResponse();
    await handleKmsOAuthCallback();
    vi.setSystemTime(now + 59_999);
    await expect(beginKmsAuthorization('/my-keys')).rejects.toMatchObject({ message: '刚刚完成授权仍无法通过校验，请重新从统一应用门户进入' });
    expect(assign).not.toHaveBeenCalled();
    vi.setSystemTime(now + 60_000);
    await beginKmsAuthorization('/my-keys');
    expect(new URL(assign.mock.lastCall?.[0] as string, location.origin).pathname).toBe('/oauth2/authorize');
  });

  it('handles disabled session storage without exposing credentials or crashing cleanup', async () => {
    const blocked = () => { throw new Error('storage blocked'); };
    vi.stubGlobal('window', { sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked }, location, fetch: fetchMock });
    expect(getKmsAccessToken()).toBeNull();
    expect(() => clearKmsAccessToken()).not.toThrow();
    await beginKmsAuthorization('/my-keys');
    expect(new URL(assign.mock.lastCall?.[0] as string, location.origin).pathname).toBe('/oauth2/authorize');
    location.search = '?code=one&state=missing';
    await expect(handleKmsOAuthCallback()).resolves.toEqual({ kind: 'retrying' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
