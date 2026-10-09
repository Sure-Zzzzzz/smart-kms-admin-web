import { createApp } from 'vue';
import { expect, it } from 'vitest';
import StandaloneGuideView from './StandaloneGuideView.vue';

it('directs standalone visitors to the portal without a local sign-in or admin action', () => {
  const root = document.createElement('div');
  const app = createApp(StandaloneGuideView);
  app.mount(root);
  expect(root.querySelector('.page-header h1')?.textContent).toBe('KMS 管理');
  expect(root.querySelector('h2')?.textContent).toBe('请从门户进入');
  expect(root.textContent).toContain('请从统一应用门户进入密钥管理。');
  expect(root.querySelectorAll('button, a, input')).toHaveLength(0);
  app.unmount();
});
