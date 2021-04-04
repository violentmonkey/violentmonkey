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
  }
}

function handleEscape() {
  document.activeElement.blur();
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
}
