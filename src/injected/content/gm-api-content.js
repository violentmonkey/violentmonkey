import bridge, { addBackgroundHandlers, addHandlers, grantless } from './bridge';
import { addNonceAttribute } from './inject';
import { decodeResource, elemByTag, makeElem, nextTask, sendCmd } from './util';

const menus = createNullObj();
const HEAD_TAGS = ['script', 'style', 'link', 'meta'];
const IS_CHROMIUM_MV3 = chrome.runtime.getManifest().manifest_version === 3;
const { toLowerCase } = '';
const { [IDS]: ids } = bridge;
let setPopupThrottle;
let isPopupShown;
let grantlessUsage;

addBackgroundHandlers({
  async PopupShown(state) {
    await bridge[REIFY];
    isPopupShown = state;
    for (const realm in grantless) {
      bridge.post('GetGrantless', null, realm);
    }
    void sendSetPopup().catch(logging.error);
  },
}, true);

addHandlers({
  /** @this {Node} */
  AddElement({ tag, attrs, cbId }, realm) {
    let el;
    let res;
    try {
      if (IS_CHROMIUM_MV3 && `${tag}`::toLowerCase() === 'script') {
        throw new SafeError('GM_addElement(script, ...) is blocked in Chromium MV3 due to page CSP restrictions.');
      }
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

  SetGrantless(data) {
    assign(grantlessUsage ??= createNullObj(), data);
  },

  RegisterMenu({ id, key, val }) {
    (menus[id] || (menus[id] = createNullObj()))[key] = val;
    void sendSetPopup(true).catch(logging.error);
  },

  UnregisterMenu({ id, key }) {
    delete menus[id]?.[key];
    void sendSetPopup(true).catch(logging.error);
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
      grantless: grantlessUsage,
      menus,
    }, { retry: true });
  }
}
