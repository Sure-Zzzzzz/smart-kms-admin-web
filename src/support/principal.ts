/**
 * 主体标识的展示辅助：显示名优先、原始标识回退，并解析来源前缀。
 */

export type PrincipalSourceKind = 'iam' | 'aksk' | null;

/** 解析稳定主体标识的来源前缀；未知来源返回 null。 */
export function principalSourceKind(principalId?: string | null): PrincipalSourceKind {
  if (typeof principalId !== 'string' || !principalId) return null;
  if (principalId.startsWith('iam:')) return 'iam';
  if (principalId.startsWith('aksk:')) return 'aksk';
  return null;
}

/** 来源前缀的可读名称；未知来源返回空。 */
export function principalSourceText(kind: PrincipalSourceKind): string {
  if (kind === 'iam') return '平台人员';
  if (kind === 'aksk') return '服务凭证';
  return '';
}

/** 主体展示标签：显示名优先，缺失时回退原始标识；两者皆无返回占位符。 */
export function principalLabel(principalId?: string | null, displayName?: string | null): string {
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
  if (typeof principalId === 'string' && principalId) return principalId;
  return '—';
}

/** 后端 UTC 毫秒字符串的本地可读时间；缺失返回占位符。 */
export function readableTime(value?: string | null): string {
  if (typeof value !== 'string' || !value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}
