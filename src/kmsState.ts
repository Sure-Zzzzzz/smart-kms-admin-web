import { reactive } from 'vue';
import type { RuntimeContext, Subscription } from '@sure-zzzzzz/simple-frontend-contract';
import type { ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';

export interface KmsPortalUser {
  userId: number | null;
  username: string;
  displayName: string | null;
}

export interface KmsBridge extends RuntimeContext {
  getCurrentUser?: () => KmsPortalUser | null;
  currentUser?: KmsPortalUser | null;
  onUnauthorized?: () => void;
  theme?: Subscription<ThemeSnapshot>;
}

export interface KmsMountProps extends Partial<KmsBridge> {
  apiBase?: string | null;
}

export interface KmsMe {
  principalId: string;
  subjectType: 'HUMAN' | 'SERVICE';
  scopes: string[];
  pagePermissions: string[];
}

export const kmsState = reactive({
  currentUser: null as KmsPortalUser | null,
  bridge: null as KmsBridge | null,
  apiBase: '',
  me: null as KmsMe | null,
  meLoaded: false
});

export function applyKmsBridge(props?: KmsMountProps) {
  // 嵌入形态判定以 qiankun 环境为准（门户挂载必经 qiankun）；props 细节缺失不降级为 standalone
  const embedded = Boolean(props?.getCurrentUser)
    || Boolean((globalThis as unknown as { __POWERED_BY_QIANKUN__?: boolean }).__POWERED_BY_QIANKUN__);
  kmsState.bridge = embedded && props ? props as KmsBridge : null;
  kmsState.apiBase = typeof props?.apiBase === 'string' ? props.apiBase.replace(/\/+$/, '') : '';
  kmsState.currentUser = props?.getCurrentUser?.() || props?.currentUser || null;
}

export function setKmsMe(me: KmsMe | null) {
  kmsState.me = me;
  kmsState.meLoaded = me !== null;
}

export function hasKmsPagePermission(permission: string) {
  return kmsState.me?.pagePermissions.includes(permission) === true;
}

/**
 * PAGE 只决定入口可见性，写操作必须再按资源服务返回的精确 API 权限收敛。
 */
export function hasKmsApiPermission(permission: string) {
  return kmsState.me?.scopes.includes(permission) === true;
}
