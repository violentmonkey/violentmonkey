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
