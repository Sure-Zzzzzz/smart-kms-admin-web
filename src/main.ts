import { createApp, type App as VueApp } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import { applyTheme, createLightThemePreference, type ThemePreference, type ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import App from './App.vue';
import { beginKmsAuthorization } from './auth/pkce';
import { loadKmsMe, KmsApiError } from './api/kmsApi';
import { applyKmsBridge, hasKmsPagePermission, kmsState, setKmsMe, type KmsMountProps } from './kmsState';
import KeysView from './view/KeysView.vue';
import MyKeysView from './view/MyKeysView.vue';
import PoliciesView from './view/PoliciesView.vue';
import DestructionView from './view/DestructionView.vue';
import ForbiddenView from './view/ForbiddenView.vue';
import OAuthCallbackView from './view/OAuthCallbackView.vue';
import StandaloneGuideView from './view/StandaloneGuideView.vue';
import './style.css';

let app: VueApp<Element> | null = null;
let router: Router | null = null;
let releaseTheme: () => void = () => undefined;
let themeSnapshot: ThemePreference = createLightThemePreference();

interface MountProps extends KmsMountProps {
  container?: Element | Document;
  routePrefix?: string;
  theme?: { current(): ThemeSnapshot; subscribe(listener: (value: ThemeSnapshot) => void): () => void };
}

const pagePermissionByRoute: Record<string, string> = {
  '/my-keys': 'kms.page.my-keys',
  '/keys': 'kms.page.keys',
  '/policies': 'kms.page.policies',
  '/destruction': 'kms.page.destruction'
};

function applyHostTheme(root: HTMLElement, props: MountProps, subscribe = true) {
  if (props.theme) themeSnapshot = props.theme.current();
  applyTheme(root, themeSnapshot);
  if (!subscribe || !props.theme) return;
  releaseTheme();
  releaseTheme = props.theme.subscribe(next => {
    themeSnapshot = next;
    applyTheme(root, themeSnapshot);
  });
}

function createKmsRouter(base: string) {
  const instance = createRouter({
    history: createWebHistory(base),
    routes: [
      { path: '/', component: StandaloneGuideView },
      { path: '/keys', component: KeysView },
      { path: '/my-keys', component: MyKeysView },
      { path: '/policies', component: PoliciesView },
      { path: '/destruction', component: DestructionView },
      { path: '/oauth-callback', component: OAuthCallbackView },
      { path: '/403', component: ForbiddenView },
      // 根路由由守卫按 IAM 下发的页面权限选择首个可达页面。
      { path: '/:pathMatch(.*)*', redirect: '/' }
    ]
  });
  instance.beforeEach(async to => {
    if (to.path === '/oauth-callback' || to.path === '/403') return true;
    if (!kmsState.bridge) return to.path === '/' ? true : '/';
    const permission = pagePermissionByRoute[to.path];
    try {
      setKmsMe(await loadKmsMe());
    } catch (error) {
      if (error instanceof KmsApiError && error.status === 401) {
        await beginKmsAuthorization(to.fullPath);
        return false;
      }
      return '/403';
    }
    if (!permission) {
      if (hasKmsPagePermission('kms.page.my-keys')) return '/my-keys';
      if (hasKmsPagePermission('kms.page.keys')) return '/keys';
      return '/403';
    }
    return hasKmsPagePermission(permission) ? true : '/403';
  });
  return instance;
}

function render(props: MountProps = {}) {
  applyKmsBridge(props);
  router = createKmsRouter(qiankunWindow.__POWERED_BY_QIANKUN__ ? `${props.routePrefix || '/app/kms'}/` : '/app/kms/');
  app = createApp(App);
  app.use(router);
  const container = props.container?.querySelector('#app') || document.querySelector('#app');
  if (container instanceof HTMLElement) {
    app.mount(container);
    const root = container.querySelector<HTMLElement>('.kms-admin-app');
    if (root) applyHostTheme(root, props);
  }
}

renderWithQiankun({
  bootstrap() {},
  mount(props) { render(props as MountProps); },
  unmount() {
    releaseTheme();
    releaseTheme = () => undefined;
    app?.unmount();
    app = null;
    router = null;
    themeSnapshot = createLightThemePreference();
    setKmsMe(null);
    applyKmsBridge();
  },
  update(props) {
    const mountProps = props as MountProps;
    applyKmsBridge(mountProps);
    const container = mountProps.container?.querySelector('#app') || document.querySelector('#app');
    const root = container instanceof HTMLElement ? container.querySelector<HTMLElement>('.kms-admin-app') : null;
    if (root) applyHostTheme(root, mountProps, Boolean(mountProps.theme));
  }
});

if (!qiankunWindow.__POWERED_BY_QIANKUN__) render();
