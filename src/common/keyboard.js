import { KeyboardService } from '@violentmonkey/shortcut';
import { getActiveElement } from '@/common/ui';

export * from '@violentmonkey/shortcut';

let prevBitState = 0;
export const keyboardService = new KeyboardService();
export const kbdEnterable = 'canEnter';
export const kbdTypable = 'canType';
export const kbdNavigatable = 'canNav';
/** @param {HTMLElement} el */
export const isInput = ({ localName: n } = {}) =>
  n === 'button' ? ENTERABLE
    : n === 'input' ? ENTERABLE + TYPABLE
      : n === 'select' || n === 'textarea' ? ENTERABLE + TYPABLE + NAVIGATABLE
        : 0;
const ENTERABLE = 1;
const TYPABLE = 2;
const NAVIGATABLE = 4;
const BIT_CTX = {
  [ENTERABLE]: kbdEnterable,
  [TYPABLE]: kbdTypable,
  [NAVIGATABLE]: kbdNavigatable,
};

bindKeys();

/**
 * @param {FocusEvent} evt
 * @param {boolean} [state]
 * @return {number}
 */
function handleFocus(evt, state = true) {
  const type = isInput(evt.target);
  for (const bit in BIT_CTX) {
    const bitState = +state && (type & bit);
    if (bitState !== (prevBitState & bit)) {
      keyboardService.setContext(BIT_CTX[bit], !!bitState);
      if (state) prevBitState |= bit; else prevBitState &= ~bit;
    }
  }
  return type;
}

/** @param {FocusEvent} evt */
function handleBlur(evt) {
  if (evt.relatedTarget ? !isInput(evt.target) : !handleFocus(evt, false)) {
    const event = new CustomEvent('tiphide', {
      bubbles: true,
    });
    evt.target.dispatchEvent(event);
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
