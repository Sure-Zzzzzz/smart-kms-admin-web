import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listKmsKeys, loadKmsMe } from './kmsApi';
import { kmsState } from '../kmsState';

const fetchMock = vi.fn();

describe('kmsApi', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    kmsState.apiBase = '';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('uses the injected API base with Bearer and no Portal cookie', async () => {
    kmsState.apiBase = '/gateway/kms';
    window.sessionStorage.setItem('kms.accessToken', 'token-1');
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{"items":[],"page":1,"size":20,"total":0}') });

    await listKmsKeys({ page: 1, size: 20 });

    expect(fetchMock).toHaveBeenCalledWith('/gateway/kms/keys?page=1&size=20', expect.objectContaining({
      credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer token-1' })
    }));
  });

  it('clears a stale token when the KMS resource server returns 401', async () => {
    window.sessionStorage.setItem('kms.accessToken', 'token-1');
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('') });

    await expect(loadKmsMe()).rejects.toMatchObject({ status: 401 });

    expect(window.sessionStorage.getItem('kms.accessToken')).toBeNull();
  });
});
