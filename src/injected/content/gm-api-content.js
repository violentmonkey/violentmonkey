import bridge, { addBackgroundHandlers, addHandlers, grantless } from './bridge';
import { addNonceAttribute } from './inject';
import { decodeResource, elemByTag, makeElem, nextTask, sendCmd } from './util';

export const menus = createNullObj();
const HEAD_TAGS = ['script', 'style', 'link', 'meta'];
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
    sendSetPopup();
  },
}, true);

addHandlers({
  /** @this {Node} */
  AddElement({ tag, attrs }, realm, nodeRet) {
    const parent = this
      || HEAD_TAGS::includes(`${tag}`::toLowerCase()) && elemByTag('head')
      || elemByTag('body')
      || elemByTag('*');
    const el = makeElem(tag, attrs);
    addNonceAttribute(el);
    parent::appendChild(el);
    nodeRet[0] = el;
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
    sendSetPopup(true);
    sendCmd('UpdateTabMenuCommands', menus);
  },

  UnregisterMenu({ id, key }) {
    delete menus[id]?.[key];
    sendSetPopup(true);
    sendCmd('UpdateTabMenuCommands', menus);
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
    });
  }
}
