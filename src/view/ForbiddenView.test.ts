import { createApp } from 'vue';
import { expect, it } from 'vitest';
import ForbiddenView from './ForbiddenView.vue';

it('announces denied access without exposing privileged actions', () => {
  const root = document.createElement('div');
  const app = createApp(ForbiddenView);
  app.mount(root);
  expect(root.querySelector('[role="alert"] h2')?.textContent).toBe('无权访问');
  expect(root.querySelector('p')?.textContent).toBe('当前身份没有访问此页面的权限。');
  expect(root.querySelectorAll('button, a, input')).toHaveLength(0);
  app.unmount();
});
