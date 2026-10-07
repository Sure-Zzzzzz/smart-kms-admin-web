import { createServer } from 'node:net';
import { startKmsPreview } from './preview.mjs';
import { startFixtureHost } from './host-server.mjs';

async function assertFreePort(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(new Error(`浏览器验收端口 ${port} 已占用或不可用。`, { cause: error })));
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  });
}

export default async function setup() {
  await assertFreePort(4188);
  await assertFreePort(4189);
  const servers = [];
  try {
    servers.push(await startKmsPreview());
    servers.push(await startFixtureHost());
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    throw error;
  }
  // 同进程管理预览服务，避免 Windows 的 taskkill 无法清理外层 shell 进程。
  return async () => { await Promise.all(servers.map(closeServer)); };
}
