import * as bridge from './bridge';
import { addNonceAttribute, injectedInfo, injectedRealms } from './inject';
import { decodeResource, elemByTag, makeElem, nextTask, sendCmd } from './util';

const menus = createNullObj();
const HEAD_TAGS = ['script', 'style', 'link', 'meta'];
const { toLowerCase } = '';
const jsonStringify = JSON.stringify;
let sentMenus = '{}';
let setPopupThrottle;
let isPopupShown;
let grantlessUsage;

bridge.addBackgroundHandlers({
  SetGMI(data) {
    for (const realm in injectedRealms) {
      // Augment info if still injecting scripts
      if (injectedInfo?.[realm]) assign(injectedInfo[realm], data);
      bridge.post('SetGMI', data, realm);
    }
  },
  [kUseMenu](state) {
    bridge.useMenu = state; // eslint-disable-line no-import-assign
    if (state) sendSetPopup();
  },
});

bridge.addBackgroundHandlers({
  async PopupShown(state) {
    if (bridge.reify) await bridge.reify;
    isPopupShown = state;
    for (const realm in bridge.grantless) {
      bridge.post('GetGrantless', null, realm);
    }
    sendSetPopup();
  },
}, true);

bridge.addHandlers({
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
      [IDS]: bridge.ids,
      [INJECT_INTO]: bridge.injectInto,
      grantless: grantlessUsage,
      menus,
    });
  } else if (bridge.useMenu) {
    const str = jsonStringify(menus);
    if (str !== sentMenus) {
      sentMenus = str;
      await sendCmd('SetMenus', str);
    }
  }
}
