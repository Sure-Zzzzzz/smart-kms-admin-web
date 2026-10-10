const KEY_STATE_LABELS: Record<string, string> = {
  ACTIVE: '活动',
  DISABLED: '已停用',
  PENDING_DESTRUCTION: '待销毁',
  DESTROYED: '已销毁'
};

const KEY_PURPOSE_LABELS: Record<string, string> = {
  SIGN: '签名',
  ENCRYPT: '加解密'
};

const KEY_ALGORITHM_LABELS: Record<string, string> = {
  ES256: 'ES256',
  AES_256_GCM: 'AES-256-GCM'
};

const POLICY_OPERATION_LABELS: Record<string, string> = {
  SIGN: '签名',
  VERIFY: '验签',
  ENCRYPT: '加密',
  DECRYPT: '解密',
  READ_PUBLIC_KEY: '读取公钥'
};

const DESTRUCTION_STATE_LABELS: Record<string, string> = {
  PENDING: '待处理',
  CLAIMED: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消'
};

export function keyStateLabel(value: string): string {
  return KEY_STATE_LABELS[value] ?? value;
}

export function keyPurposeLabel(value: string): string {
  return KEY_PURPOSE_LABELS[value] ?? value;
}

export function keyAlgorithmLabel(value: string): string {
  return KEY_ALGORITHM_LABELS[value] ?? value;
}

export function policyOperationLabel(value: string): string {
  return POLICY_OPERATION_LABELS[value] ?? value;
}

export function destructionStateLabel(value: string): string {
  return DESTRUCTION_STATE_LABELS[value] ?? value;
}
