import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('./host', import.meta.url));
const outDir = resolve(root, '../../../test-results/fixture-host');
const config = {
  configFile: false,
  root,
  base: '/',
  envDir: false,
  publicDir: false,
  build: { outDir, emptyOutDir: true },
  preview: {
    host: '127.0.0.1', port: 4189, strictPort: true,
    // 同源统一入口保留宿主 SPA 路由，仅转发子应用 entry 和静态资源。
    proxy: {
      '/app/kms/index.html': 'http://127.0.0.1:4188',
      '/app/kms/assets/': 'http://127.0.0.1:4188'
    }
  }
};

export async function startFixtureHost() {
  await build(config);
  return preview(config);
}
