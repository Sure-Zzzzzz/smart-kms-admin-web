import { defineConfig } from 'vite';
import type { UserConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const config = {
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    poolOptions: { threads: { singleThread: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
        'src/{api,auth}/**/*.ts': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90
        }
      }
    }
  } satisfies NonNullable<UserConfig['test']>
};

export default defineConfig(config);
