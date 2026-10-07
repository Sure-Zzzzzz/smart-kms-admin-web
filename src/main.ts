import { createApp, type App as VueApp } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import { applyTheme, createLightThemePreference, type ThemePreference, type ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import App from './App.vue';
import { beginKmsAuthorization, getKmsAccessToken } from './auth/pkce';
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
let mountLifetime: AbortController | null = null;
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

function applyHostTheme(root: HTMLElement, props: MountProps) {
  releaseTheme();
  releaseTheme = () => undefined;
  if (props.theme) themeSnapshot = props.theme.current();
  applyTheme(root, themeSnapshot);
  if (!props.theme) return;
  releaseTheme = props.theme.subscribe(next => {
    themeSnapshot = next;
    applyTheme(root, themeSnapshot);
  });
}

function createKmsRouter(base: string, lifetime: AbortController) {
  const isCurrentMount = () => mountLifetime === lifetime && !lifetime.signal.aborted;
  let activeNavigation: AbortController | null = null;
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
    if (!isCurrentMount()) return false;
    activeNavigation?.abort();
    const navigation = new AbortController();
    activeNavigation = navigation;
    const abortNavigation = () => navigation.abort();
    lifetime.signal.addEventListener('abort', abortNavigation, { once: true });
    const isCurrentNavigation = () => isCurrentMount() && activeNavigation === navigation && !navigation.signal.aborted;
    const token = getKmsAccessToken();
    try {
      if (to.path === '/oauth-callback' || to.path === '/403') return true;
      if (!kmsState.bridge) return to.path === '/' ? true : '/';
      const permission = pagePermissionByRoute[to.path];
      try {
        const me = await loadKmsMe(navigation.signal);
        if (!isCurrentNavigation() || getKmsAccessToken() !== token) return false;
        setKmsMe(me);
      } catch (error) {
        if (!isCurrentNavigation()) return false;
        const currentToken = getKmsAccessToken();
        if (currentToken !== null && currentToken !== token) return false;
        setKmsMe(null);
        if (error instanceof KmsApiError && error.status === 401) {
          try {
            await beginKmsAuthorization(to.fullPath, navigation.signal);
          } catch {
            if (!isCurrentNavigation()) return false;
            const authorizationToken = getKmsAccessToken();
            if (authorizationToken !== null && authorizationToken !== currentToken) return false;
            return '/403';
          }
          return false;
        }
        return '/403';
      }
      if (!permission) {
        return Object.entries(pagePermissionByRoute).find(([, pagePermission]) => hasKmsPagePermission(pagePermission))?.[0] || '/403';
      }
      return hasKmsPagePermission(permission) ? true : '/403';
    } finally {
      lifetime.signal.removeEventListener('abort', abortNavigation);
    }
  });
  return instance;
}

function render(props: MountProps = {}) {
  mountLifetime?.abort();
  const lifetime = new AbortController();
  mountLifetime = lifetime;
  applyKmsBridge(props);
  router = createKmsRouter(qiankunWindow.__POWERED_BY_QIANKUN__ ? `${props.routePrefix || '/app/kms'}/` : '/app/kms/', lifetime);
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
    // 先取消守卫，避免已卸载应用的迟到权限响应或授权结果影响门户。
    mountLifetime?.abort();
    mountLifetime = null;
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
    if (root) applyHostTheme(root, mountProps);
  }
});

if (!qiankunWindow.__POWERED_BY_QIANKUN__) render();
