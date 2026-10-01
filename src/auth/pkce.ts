const PKCE_STATE_PREFIX = 'kms.pkce.';
const ACCESS_TOKEN_KEY = 'kms.accessToken';
const ACCESS_TOKEN_EXPIRES_AT_KEY = 'kms.accessTokenExpiresAt';
const LAST_AUTH_AT_KEY = 'kms.lastAuthAt';
const RETRY_COUNT_KEY = 'kms.pkce.retry';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const REAUTH_MIN_INTERVAL_MS = 60_000;

export class KmsPkceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KmsPkceError';
  }
}

export type KmsCallbackOutcome = { kind: 'authorized'; target: string } | { kind: 'retrying' } | { kind: 'missing-params' };

function read(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* 存储不可用时本次授权会自然失败 */ }
}

function remove(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* 同上 */ }
}

function readNumber(key: string) {
  const value = Number(read(key));
  return Number.isFinite(value) ? value : Number.NaN;
}

function clientId() {
  const value = import.meta.env.VITE_KMS_PKCE_CLIENT_ID as string | undefined;
  if (!value) throw new KmsPkceError('未配置 VITE_KMS_PKCE_CLIENT_ID，无法发起授权');
  return value;
}

function redirectUri() {
  const origin = window.location.origin.replace('//localhost:', '//127.0.0.1:');
  return `${origin}${import.meta.env.BASE_URL}oauth-callback`;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function random() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encode(bytes);
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return encode(new Uint8Array(digest));
}

export function getKmsAccessToken() { return read(ACCESS_TOKEN_KEY); }

export function clearKmsAccessToken() {
  remove(ACCESS_TOKEN_KEY);
  remove(ACCESS_TOKEN_EXPIRES_AT_KEY);
}

export function hasValidKmsAccessToken() {
  const expiry = readNumber(ACCESS_TOKEN_EXPIRES_AT_KEY);
  return Boolean(read(ACCESS_TOKEN_KEY)) && Number.isFinite(expiry) && Date.now() < expiry - TOKEN_EXPIRY_SKEW_MS;
}

async function authorizeUrl(target: string) {
  const state = random();
  const verifier = random();
  write(`${PKCE_STATE_PREFIX}${state}`, JSON.stringify({ verifier, target }));
  const search = new URLSearchParams({
    response_type: 'code', client_id: clientId(), redirect_uri: redirectUri(), state,
    code_challenge: await challenge(verifier), code_challenge_method: 'S256'
  });
  return `/oauth2/authorize?${search.toString()}`;
}

export async function beginKmsAuthorization(target = '/') {
  const last = readNumber(LAST_AUTH_AT_KEY);
  if (Number.isFinite(last) && Date.now() - last < REAUTH_MIN_INTERVAL_MS) {
    throw new KmsPkceError('刚刚完成授权仍无法通过校验，请重新从统一应用门户进入');
  }
  window.location.assign(await authorizeUrl(target));
}

export async function handleKmsOAuthCallback(): Promise<KmsCallbackOutcome> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) throw new KmsPkceError(`授权失败：${params.get('error')}`);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return { kind: 'missing-params' };
  const stored = read(`${PKCE_STATE_PREFIX}${state}`);
  remove(`${PKCE_STATE_PREFIX}${state}`);
  let verifier = '';
  let target = '/';
  try {
    const value = stored ? JSON.parse(stored) as { verifier?: string; target?: string } : null;
    verifier = typeof value?.verifier === 'string' ? value.verifier : '';
    target = typeof value?.target === 'string' && value.target.startsWith('/') ? value.target : '/';
  } catch { /* 非法状态值按缺少 verifier 处理 */ }
  if (!verifier) return retry(target);
  const response = await window.fetch('/oauth2/token', {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: clientId(), code_verifier: verifier }).toString()
  });
  if (!response.ok) return retry(target);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) return retry(target);
  write(ACCESS_TOKEN_KEY, payload.access_token);
  write(ACCESS_TOKEN_EXPIRES_AT_KEY, String(Date.now() + (payload.expires_in || 3600) * 1000));
  write(LAST_AUTH_AT_KEY, String(Date.now()));
  remove(RETRY_COUNT_KEY);
  window.history.replaceState(window.history.state, '', window.location.pathname);
  return { kind: 'authorized', target };
}

async function retry(target: string): Promise<KmsCallbackOutcome> {
  const attempts = readNumber(RETRY_COUNT_KEY);
  if (Number.isFinite(attempts) && attempts >= 1) {
    remove(RETRY_COUNT_KEY);
    throw new KmsPkceError('令牌交换失败，请重新从统一应用门户进入');
  }
  write(RETRY_COUNT_KEY, '1');
  await beginKmsAuthorization(target);
  return { kind: 'retrying' };
}
