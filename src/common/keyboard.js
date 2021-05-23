import { KeyboardService } from '@violentmonkey/shortcut';

export * from '@violentmonkey/shortcut';

export const keyboardService = new KeyboardService();

bindKeys();

export function isInput(el) {
  return ['input', 'textarea'].includes(el?.tagName?.toLowerCase());
}

function handleFocus(e) {
  if (isInput(e.target)) {
    keyboardService.setContext('inputFocus', true);
  }
}

function handleBlur(e) {
  if (isInput(e.target)) {
    keyboardService.setContext('inputFocus', false);
  } else {
    const event = new CustomEvent('tiphide', {
      bubbles: true,
    });
    e.target.dispatchEvent(event);
  }
}

function handleEscape() {
  document.activeElement.blur();
}

export function toggleTip(el) {
  const event = new CustomEvent('tiptoggle', {
    bubbles: true,
  });
  el.dispatchEvent(event);
}

function bindKeys() {
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('blur', handleBlur, true);
  keyboardService.register('escape', handleEscape);
  keyboardService.register('c-[', handleEscape);
  keyboardService.register('enter', () => {
    const { activeElement } = document;
    activeElement.click();
  }, {
    condition: '!inputFocus',
  });
  keyboardService.register('?', () => {
    toggleTip(document.activeElement);
  }, {
    condition: '!inputFocus',
    caseSensitive: true,
  });
}

/**
 * Note: This is only used in Firefox to work around the issue that <a> cannot be focused.
 * Ref: https://stackoverflow.com/a/11713537/4238335
 */
export function handleTabNavigation(dir) {
  const els = Array.from(document.querySelectorAll('[tabindex="0"],a[href],button,input,select,textarea'))
  .filter(el => {
    if (el.tabIndex < 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  let index = els.indexOf(document.activeElement);
  index = (index + dir + els.length) % els.length;
  els[index].focus();
}
