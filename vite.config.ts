import http from 'node:http';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig({
  base: '/app/kms/',
  plugins: [vue(), qiankun('kms', { useDevMode: true })],
  server: {
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    proxy: {
      '/api/kms': { target: 'http://localhost:8091', agent: new http.Agent({ keepAlive: false }) }
    }
  }
});
