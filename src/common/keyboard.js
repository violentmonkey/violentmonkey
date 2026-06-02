import { KeyboardService } from '@violentmonkey/shortcut';
import { getActiveElement } from '@/common/ui';

export * from '@violentmonkey/shortcut';

export const keyboardService = new KeyboardService();
export const kbdEnterable = 'canEnter';
export const kbdTypable = 'canType';
export const kbdNavigatable = 'canNav';

bindKeys();

export function isInput({ localName: n } = {}) {
  return n === 'button' ? 1
    : n === 'input' ? 1 + 2
      : n === 'select' || n === 'textarea' ? 1 + 2 + 4
        : 0;
}

function handleFocus(e, state = true) {
  if ((e = isInput(e.target))) {
    if (e & 1) keyboardService.setContext(kbdEnterable, state);
    if (e & 2) keyboardService.setContext(kbdTypable, state);
    if (e & 4) keyboardService.setContext(kbdNavigatable, state);
    return true;
  }
}

function handleBlur(e) {
  if (!handleFocus(e, false)) {
    const event = new CustomEvent('tiphide', {
      bubbles: true,
    });
    e.target.dispatchEvent(event);
  }
}

export function toggleTip(el) {
  const event = new CustomEvent('tiptoggle', {
    bubbles: true,
  });
  el.dispatchEvent(event);
}

function bindKeys() {
  addEventListener('focus', handleFocus, true);
  addEventListener('blur', handleBlur, true);
  keyboardService.register('enter', () => {
    getActiveElement().click();
  }, {
    condition: '!' + kbdEnterable,
  });
}

/**
 * Note: This is only used in Firefox to work around the issue that <a> cannot be focused.
 * Ref: https://stackoverflow.com/a/11713537/4238335
 */
export function handleTabNavigation(dir) {
  const els = document.querySelectorAll('[tabindex="0"],a[href],button,input,select,textarea')
  ::[].filter(el => {
    if (el.tabIndex < 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  let index = els.indexOf(getActiveElement());
  index = (index + dir + els.length) % els.length;
  els[index].focus();
}
