import { loadMicroApp } from 'qiankun';
import {
  applyTheme,
  createDefaultCustomThemeTokens,
  CUSTOM_THEME_TOKEN_KEYS,
  type ThemeMode,
  type ThemeSnapshot
} from '@sure-zzzzzz/simple-iam-theme-contract';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import './style.css';

const customTokens = {
  ...createDefaultCustomThemeTokens(),
  primary: '#006B5E',
  primaryHover: '#00594E',
  primaryActive: '#00483F',
  primaryWeak: '#DCF4EE',
  focusRing: '#A61E4D',
  canvas: '#F3F8F6'
};
let snapshot: ThemeSnapshot = { contractVersion: 1, mode: 'light', customTokens: {} };
const listeners = new Set<(value: ThemeSnapshot) => void>();

function setTheme(mode: ThemeMode) {
  snapshot = mode === 'custom'
    ? { contractVersion: 1, mode, customTokens: { ...customTokens } }
    : { contractVersion: 1, mode, customTokens: {} };
  applyTheme(document.documentElement, snapshot);
  listeners.forEach(listener => listener(snapshot));
}

const app = loadMicroApp({
  name: 'kms',
  entry: `${window.location.origin}/app/kms/index.html`,
  container: '#micro-app',
  props: {
    routePrefix: '/app/kms',
    apiBase: '/api/kms',
    getCurrentUser: () => ({ userId: 1, username: 'browser-user', displayName: '验收用户' }),
    theme: {
      current: () => snapshot,
      subscribe(listener: (value: ThemeSnapshot) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    }
  }
}, { sandbox: { experimentalStyleIsolation: true }, singular: true });

window.__kmsFixture = {
  ready: false,
  setTheme,
  customTokens,
  tokenKeys: [...CUSTOM_THEME_TOKEN_KEYS],
  subscriberCount: () => listeners.size,
  unmount: () => app.unmount()
};

app.mountPromise.then(() => { window.__kmsFixture.ready = true; }).catch(error => {
  const target = document.getElementById('fixture-error');
  if (target) {
    target.hidden = false;
    target.textContent = error instanceof Error ? error.message : '子应用挂载失败';
  }
});

declare global {
  interface Window {
    __kmsFixture: {
      ready: boolean;
      setTheme(mode: ThemeMode): void;
      customTokens: Record<string, string>;
      tokenKeys: string[];
      subscriberCount(): number;
      unmount(): Promise<unknown>;
    };
  }
}
