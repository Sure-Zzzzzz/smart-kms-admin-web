import { build, preview } from 'vite';

export async function startKmsPreview() {
  // 固定公开测试客户端并禁用本机 .env，验收使用 production 构建。
  await build({
    mode: 'production',
    envDir: false,
    build: { outDir: 'test-results/kms-production', emptyOutDir: true },
    define: { 'import.meta.env.VITE_KMS_PKCE_CLIENT_ID': JSON.stringify('kms-browser-public-client') }
  });
  return preview({
    envDir: false,
    build: { outDir: 'test-results/kms-production' },
    preview: { host: '127.0.0.1', port: 4188, strictPort: true, cors: true }
  });
}
