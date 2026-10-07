import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyKmsBridge, hasKmsApiPermission, hasKmsPagePermission, kmsState, setKmsMe } from './kmsState';

describe('kmsState permission helpers', () => {
  beforeEach(() => {
    setKmsMe(null);
    applyKmsBridge();
    vi.stubGlobal('__POWERED_BY_QIANKUN__', false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps PAGE visibility and API actions as independent checks', () => {
    setKmsMe({
      principalId: 'iam:user-1',
      subjectType: 'HUMAN',
      pagePermissions: ['kms.page.my-keys'],
      scopes: ['kms.me.read', 'kms.key.read']
    });

    expect(hasKmsPagePermission('kms.page.my-keys')).toBe(true);
    expect(hasKmsApiPermission('kms.key.manage')).toBe(false);
    expect(hasKmsApiPermission('kms.key.read')).toBe(true);
  });

  it('clears loaded identity and denies both permission kinds after reset', () => {
    expect(kmsState.meLoaded).toBe(false);
    expect(hasKmsPagePermission('kms.page.my-keys')).toBe(false);
    expect(hasKmsApiPermission('kms.key.read')).toBe(false);
    setKmsMe({ principalId: 'service:1', subjectType: 'SERVICE', scopes: ['kms.key.read'], pagePermissions: [] });
    expect(kmsState.meLoaded).toBe(true);
    expect(kmsState.me?.subjectType).toBe('SERVICE');
    setKmsMe(null);
    expect(kmsState.me).toBeNull();
    expect(kmsState.meLoaded).toBe(false);
    expect(hasKmsApiPermission('kms.key.read')).toBe(false);
  });

  it('normalizes the API base and prefers the current user provider', () => {
    const user = { userId: 7, username: 'alice', displayName: 'Alice' };
    const props = { apiBase: '/gateway/kms///', getCurrentUser: () => user, currentUser: { userId: 8, username: 'bob', displayName: null } };
    applyKmsBridge(props);
    expect(kmsState.bridge).toEqual(props);
    expect(kmsState.apiBase).toBe('/gateway/kms');
    expect(kmsState.currentUser).toEqual(user);
  });

  it('keeps qiankun embedded even when its user bridge is incomplete', () => {
    vi.stubGlobal('__POWERED_BY_QIANKUN__', true);
    const props = { currentUser: { userId: null, username: 'service-user', displayName: null }, apiBase: null };
    applyKmsBridge(props);
    expect(kmsState.bridge).toEqual(props);
    expect(kmsState.currentUser).toEqual(props.currentUser);
    expect(kmsState.apiBase).toBe('');
  });

  it('falls back to supplied user and resets host context for standalone mounts', () => {
    const user = { userId: 2, username: 'bob', displayName: null };
    applyKmsBridge({ getCurrentUser: () => null, currentUser: user });
    expect(kmsState.currentUser).toEqual(user);
    applyKmsBridge();
    expect(kmsState.bridge).toBeNull();
    expect(kmsState.currentUser).toBeNull();
    expect(kmsState.apiBase).toBe('');
  });
});
