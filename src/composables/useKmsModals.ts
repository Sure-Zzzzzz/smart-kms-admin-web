import { onBeforeUnmount, onMounted, type Ref } from 'vue';

const modalSelector = '[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]';
const focusableSelector = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
const lockedProperties = ['overflow', 'overflow-x', 'overflow-y', 'padding-right'] as const;

export function useKmsModals(root: Ref<HTMLElement | null>) {
  let stop = () => {};
  onMounted(() => {
    const mountedRoot = root.value;
    if (!mountedRoot) return;
    const container = mountedRoot;
    let stopped = false;
    let modals: { element: HTMLElement; source: HTMLElement | null }[] = [];
    const focusHistory: HTMLElement[] = [];
    type ScrollLock = { element: HTMLElement; styles: { name: string; value: string; priority: string }[]; top: number; left: number };
    const locks: ScrollLock[] = [];
    const backgroundLocks = new Map<HTMLElement, ScrollLock>();

    function rememberFocus(element: Element | null) {
      if (!(element instanceof HTMLElement)) return;
      focusHistory.push(element);
      if (focusHistory.length > 32) focusHistory.shift();
    }
    rememberFocus(document.activeElement);

    function focus(element: HTMLElement) { element.focus({ preventScroll: true }); }
    function topModal() { return modals.at(-1)?.element; }
    function isVisible(element: HTMLElement) {
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return element.isConnected;
    }
    function captureScrollLock(element: HTMLElement): ScrollLock {
      const style = getComputedStyle(element);
      const lock = {
        element, top: element.scrollTop, left: element.scrollLeft,
        styles: lockedProperties.map(name => ({ name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }))
      };
      const scrollbar = element === document.documentElement
        ? window.innerWidth - element.clientWidth
        : element === document.body ? 0 : element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth || '0') - parseFloat(style.borderRightWidth || '0');
      if (scrollbar > 0) element.style.setProperty('padding-right', `${parseFloat(style.paddingRight || '0') + scrollbar}px`, 'important');
      element.style.setProperty('overflow', 'hidden', 'important');
      return lock;
    }
    function releaseScrollLock({ element, styles, top, left }: ScrollLock) {
      for (const name of lockedProperties) element.style.removeProperty(name);
      for (const { name, value, priority } of styles) if (value) element.style.setProperty(name, value, priority);
      element.scrollTop = top;
      element.scrollLeft = left;
    }
    function lockScroll() {
      const candidates = new Set<HTMLElement>([document.documentElement, document.body]);
      for (let element: HTMLElement | null = container; element; element = element.parentElement) {
        if (/(auto|scroll)/.test(`${getComputedStyle(element).overflowX} ${getComputedStyle(element).overflowY}`)) candidates.add(element);
      }
      for (const element of candidates) locks.push(captureScrollLock(element));
    }
    function unlockScroll() {
      for (const lock of locks.splice(0)) releaseScrollLock(lock);
    }
    function syncBackgroundScroll() {
      const top = topModal();
      const candidates = new Set<HTMLElement>();
      for (const modal of modals.slice(0, -1)) {
        for (const element of [modal.element, ...modal.element.querySelectorAll<HTMLElement>('*')]) {
          if (top?.contains(element) || !isVisible(element)) continue;
          const style = getComputedStyle(element);
          if (backgroundLocks.has(element) || /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) candidates.add(element);
        }
      }
      for (const [element, lock] of backgroundLocks) if (!candidates.has(element)) { releaseScrollLock(lock); backgroundLocks.delete(element); }
      for (const element of candidates) if (!backgroundLocks.has(element)) backgroundLocks.set(element, captureScrollLock(element));
    }

    function syncModals() {
      if (stopped) return;
      const previousTop = modals.at(-1);
      const elements = [...container.querySelectorAll<HTMLElement>(modalSelector)].filter(isVisible);
      const wasOpen = modals.length > 0;
      modals = elements.map(element => modals.find(modal => modal.element === element) || {
        element,
        source: [...focusHistory].reverse().find(source => source.isConnected && !element.contains(source)) || null
      });
      if (!wasOpen && modals.length) lockScroll();
      if (wasOpen && !modals.length) unlockScroll();
      syncBackgroundScroll();
      const top = topModal();
      if (previousTop && !elements.includes(previousTop.element)) {
        const source = previousTop.source;
        if (source?.isConnected && (!top || top.contains(source))) focus(source);
      }
      if (top && !top.contains(document.activeElement)) focus(top);
    }

    function handleKeydown(event: KeyboardEvent) {
      const top = topModal();
      if (!top || event.key !== 'Tab') return;
      const controls = [...top.querySelectorAll<HTMLElement>(focusableSelector)].filter(element =>
        element.tabIndex >= 0 && !element.matches(':disabled, input[type="hidden"]')
        && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      const active = document.activeElement;
      if (!first || !last || active === top || !top.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        event.stopPropagation();
        focus(event.shiftKey ? last || top : first || top);
      }
    }
    function handleFocus(event: FocusEvent) {
      rememberFocus(event.target instanceof Element ? event.target : null);
      // 关闭事件先更新 Vue DOM，再判断焦点，避免拦住共享组件返回来源的动作。
      queueMicrotask(syncModals);
    }
    const observer = new MutationObserver(syncModals);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role', 'hidden', 'style', 'class'] });
    for (let ancestor = container.parentElement; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    }
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('focusin', handleFocus);
    syncModals();
    stop = () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('focusin', handleFocus);
      for (const lock of backgroundLocks.values()) releaseScrollLock(lock);
      backgroundLocks.clear();
      unlockScroll();
      modals = [];
    };
  });
  onBeforeUnmount(() => stop());
}
