import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKmsModals } from './useKmsModals';

let wrapper: VueWrapper;
let root: HTMLElement;
let ancestor: HTMLElement;

async function settle() { await nextTick(); await Promise.resolve(); await Promise.resolve(); }
function addDialog(parent: HTMLElement, contents = '<button>First</button><button>Last</button>') {
  const dialog = document.createElement('section');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  dialog.innerHTML = contents;
  parent.append(dialog);
  return dialog;
}
function tab(shiftKey = false) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })); }

describe('KMS modal keyboard and scroll lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 20 }] as unknown as DOMRectList);
    ancestor = document.createElement('div');
    ancestor.style.overflow = 'auto';
    document.body.append(ancestor);
    wrapper = mount(defineComponent({
      setup() {
        const element = ref<HTMLElement | null>(null);
        useKmsModals(element);
        return () => h('section', { ref: element }, [h('button', { id: 'entry' }, 'Open')]);
      }
    }), { attachTo: ancestor });
    root = wrapper.element as HTMLElement;
    root.querySelector<HTMLElement>('#entry')!.focus();
  });
  afterEach(() => { wrapper.unmount(); ancestor.remove(); vi.restoreAllMocks(); });

  it('cycles Tab in the top dialog, keeps programmatic focus inside, and restores its source', async () => {
    const source = document.activeElement;
    const dialog = addDialog(root);
    await settle();
    expect(document.activeElement).toBe(dialog);
    const [first, last] = dialog.querySelectorAll('button');
    tab();
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);
    tab();
    expect(document.activeElement).toBe(first);
    (source as HTMLElement).focus();
    await settle();
    expect(document.activeElement).toBe(dialog);
    dialog.remove();
    await settle();
    expect(document.activeElement).toBe(source);
  });

  it('keeps only the nested confirmation active and returns to the drawer operation when removed', async () => {
    const drawer = addDialog(root);
    await settle();
    const operation = drawer.querySelector('button')!;
    operation.focus();
    const confirmation = addDialog(drawer);
    confirmation.setAttribute('role', 'alertdialog');
    await settle();
    tab(true);
    expect(document.activeElement).toBe(confirmation.querySelectorAll('button')[1]);
    confirmation.remove();
    await settle();
    expect(document.activeElement).toBe(operation);
    expect(document.documentElement.style.overflow).toBe('hidden');
    drawer.remove();
    await settle();
    expect(document.activeElement).toBe(root.querySelector('#entry'));
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('keeps a modal without enabled controls focused', async () => {
    const dialog = addDialog(root, '<button disabled>Pending</button><input type="hidden">');
    await settle();
    tab();
    expect(document.activeElement).toBe(dialog);
    tab(true);
    expect(document.activeElement).toBe(dialog);
  });

  it('locks a lower drawer scroller while a nested dialog remains scrollable', async () => {
    const drawer = addDialog(root);
    const content = document.createElement('div');
    content.style.setProperty('overflow-y', 'auto', 'important');
    drawer.append(content);
    await settle();
    content.scrollTop = 45;
    const confirmation = addDialog(content);
    confirmation.style.overflow = 'auto';
    await settle();
    expect(content.style.overflow).toBe('hidden');
    expect(confirmation.style.overflow).toBe('auto');
    confirmation.remove();
    await settle();
    expect(content.style.getPropertyValue('overflow-y')).toBe('auto');
    expect(content.style.getPropertyPriority('overflow-y')).toBe('important');
    expect(content.scrollTop).toBe(45);
  });

  it('ignores a dialog inside a hidden ancestor and observes it when shown', async () => {
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    root.append(hidden);
    const dialog = addDialog(hidden);
    await settle();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(root.querySelector('#entry'));
    hidden.style.display = 'block';
    await settle();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(dialog);
  });

  it('releases a modal hidden by a host ancestor and observes the ancestor becoming visible', async () => {
    const dialog = addDialog(root);
    await settle();
    expect(document.documentElement.style.overflow).toBe('hidden');
    ancestor.style.display = 'none';
    await settle();
    expect(document.documentElement.style.overflow).toBe('');
    ancestor.style.display = 'block';
    await settle();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(dialog);
  });

  it('restores existing scroll styles and priorities after the final layer closes', async () => {
    const style = ancestor.style;
    style.setProperty('overflow-x', 'scroll', 'important');
    style.setProperty('overflow-y', 'auto');
    style.setProperty('padding-right', '17px', 'important');
    const original = ['overflow', 'overflow-x', 'overflow-y', 'padding-right'].map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
    ancestor.scrollTop = 25;
    const dialog = addDialog(root);
    await settle();
    expect(style.getPropertyValue('overflow')).toBe('hidden');
    dialog.remove();
    await settle();
    expect(['overflow', 'overflow-x', 'overflow-y', 'padding-right'].map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)])).toEqual(original);
    expect(ancestor.scrollTop).toBe(25);
  });

  it('releases scroll locks and stops observing focus and DOM after unmount with a modal open', async () => {
    addDialog(root);
    await settle();
    expect(document.body.style.overflow).toBe('hidden');
    wrapper.unmount();
    await settle();
    expect(document.body.style.overflow).toBe('');
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    await settle();
    tab();
    expect(document.activeElement).toBe(outside);
    expect(document.body.style.overflow).toBe('');
    outside.remove();
  });
});
