import bridge, { addBackgroundHandlers, addHandlers } from './bridge';
import { addNonceAttribute } from './inject';
import { decodeResource, elemByTag, makeElem, nextTask, sendCmd } from './util';

const menus = createNullObj();
const HEAD_TAGS = ['script', 'style', 'link', 'meta'];
const { toLowerCase } = '';
const { [IDS]: ids } = bridge;
let setPopupThrottle;
let isPopupShown;

addBackgroundHandlers({
  async PopupShown(state) {
    await bridge[REIFY];
    isPopupShown = state;
    sendSetPopup();
  },
}, true);

addHandlers({
  /** @this {Node} */
  AddElement({ tag, attrs, cbId }, realm) {
    let el;
    let res;
    try {
      const parent = this
        || HEAD_TAGS::includes(`${tag}`::toLowerCase()) && elemByTag('head')
        || elemByTag('body')
        || elemByTag('*');
      el = makeElem(tag, attrs);
      addNonceAttribute(el);
      parent::appendChild(el);
    } catch (e) {
      // A page-mode userscript can't catch DOM errors in a content script so we pass it explicitly
      // TODO: maybe move try/catch to bridge.onHandle and use bridge.call in all web commands
      res = [`${e}`, e.stack];
    }
    bridge.post('Callback', { id: cbId, data: res }, realm, el);
  },

  GetResource({ id, isBlob, key, raw }) {
    if (!raw) raw = bridge.cache[bridge.pathMaps[id]?.[key] || key];
    return raw ? decodeResource(raw, isBlob) : true;
  },

  RegisterMenu({ id, key, val }) {
    (menus[id] || (menus[id] = createNullObj()))[key] = val;
    sendSetPopup(true);
  },

  UnregisterMenu({ id, key }) {
    delete menus[id]?.[key];
    sendSetPopup(true);
  },
});

export async function sendSetPopup(isDelayed) {
  if (isPopupShown) {
    if (isDelayed) {
      if (setPopupThrottle) return;
      // Preventing flicker in popup when scripts re-register menus
      setPopupThrottle = nextTask;
      await setPopupThrottle;
      setPopupThrottle = null;
    }
    await sendCmd('SetPopup', {
      [IDS]: ids,
      [INJECT_INTO]: bridge[INJECT_INTO],
      menus,
    });
  }
}
