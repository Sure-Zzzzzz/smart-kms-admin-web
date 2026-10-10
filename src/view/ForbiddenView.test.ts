import { createApp } from 'vue';
import { expect, it } from 'vitest';
import ForbiddenView from './ForbiddenView.vue';

it('announces denied access without exposing privileged actions', () => {
  const root = document.createElement('div');
  const app = createApp(ForbiddenView);
  app.mount(root);
  expect(root.querySelector('[role="alert"] .page-header h1')?.textContent).toBe('无权访问');
  expect(root.querySelector('[role="alert"] p')?.textContent).toBe('当前身份没有访问此页面的权限。');
  expect(root.querySelector('[role="alert"] .admin-empty-state h2')?.textContent).toBe('权限不足');
  expect(root.querySelectorAll('button, a, input')).toHaveLength(0);
  app.unmount();
});
