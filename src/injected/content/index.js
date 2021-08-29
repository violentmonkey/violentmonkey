import { getUniqId, isEmpty, sendCmd } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import { assign, objectKeys, objectPick } from '#/common/object';
import { bindEvents } from '../utils';
import {
  forEach, includes, append, createElementNS, document, setAttribute, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';
import './clipboard';
import { appendToRoot, injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';

const IS_FIREFOX = !global.chrome.app;
const IS_TOP = window.top === window;
const { invokableIds } = bridge;
const menus = {};
let isPopupShown;
let pendingSetPopup;

// Make sure to call obj::method() in code that may run after INJECT_CONTENT userscripts
const { split } = '';

(async () => {
  const contentId = getUniqId();
  const webId = getUniqId();
  // injecting right now before site scripts can mangle globals or intercept our contentId
  // except for XML documents as their appearance breaks, but first we're sending
  // a request for the data because injectPageSandbox takes ~5ms
  const dataPromise = sendCmd('GetInjected', null, { retry: true });
  const isXml = document instanceof XMLDocument;
  if (!isXml) injectPageSandbox(contentId, webId);
  // detecting if browser.contentScripts is usable, it was added in FF59 as well as composedPath
  const data = IS_FIREFOX && Event.prototype.composedPath
    ? await getDataFF(dataPromise)
    : await dataPromise;
  // 1) bridge.post may be overridden in injectScripts
  // 2) cloneInto is provided by Firefox in content scripts to expose data to the page
  bridge.post = bindEvents(contentId, webId, bridge.onHandle, global.cloneInto);
  bridge.ids = data.ids;
  bridge.isFirefox = data.info.isFirefox;
  bridge.injectInto = data.injectInto;
  if (data.scripts) injectScripts(contentId, webId, data, isXml);
  if (data.expose) bridge.post('Expose');
  isPopupShown = data.isPopupShown;
  sendSetPopup();
})().catch(IS_FIREFOX && console.error); // Firefox can't show exceptions in content scripts

bridge.addBackgroundHandlers({
  Command(data) {
    const [cmd] = data;
    const id = +cmd::split(':', 1)[0];
    const realm = invokableIds::includes(id) && INJECT_CONTENT;
    bridge.post('Command', data, realm);
  },
  PopupShown(state) {
    isPopupShown = state;
    sendSetPopup();
  },
  UpdatedValues(data) {
    const dataPage = {};
    const dataContent = {};
    objectKeys(data)::forEach((id) => {
      (invokableIds::includes(+id) ? dataContent : dataPage)[id] = data[id];
    });
    if (!isEmpty(dataPage)) bridge.post('UpdatedValues', dataPage);
    if (!isEmpty(dataContent)) bridge.post('UpdatedValues', dataContent, INJECT_CONTENT);
  },
});

bridge.addHandlers({
  UpdateValue: sendCmd,
  RegisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      const commandMap = menus[id] || (menus[id] = {});
      commandMap[cap] = 1;
      sendSetPopup(true);
    }
  },
  UnregisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      delete menus[id]?.[cap];
      sendSetPopup(true);
    }
  },
  AddElement([tag, attributes, id]) {
    try {
      const el = document::createElementNS(NS_HTML, tag);
      el::setAttribute('id', id);
      if (attributes) {
        objectKeys(attributes)::forEach(key => {
          if (key === 'textContent') el::append(attributes[key]);
          else if (key !== 'id') el::setAttribute(key, attributes[key]);
        });
      }
      appendToRoot(el);
    } catch (e) {
      // A page-mode userscript can't catch DOM errors in a content script so we pass it explicitly
      // TODO: maybe move try/catch to bridge.onHandle and use bridge.sendSync in all web commands
      return e.stack;
    }
  },
  GetScript: sendCmd,
  SetTimeout: sendCmd,
  TabFocus: sendCmd,
});

async function sendSetPopup(isDelayed) {
  if (isPopupShown) {
    if (isDelayed) {
      if (pendingSetPopup) return;
      // Preventing flicker in popup when scripts re-register menus
      pendingSetPopup = sendCmd('SetTimeout', 0);
      await pendingSetPopup;
      pendingSetPopup = null;
    }
    sendCmd('SetPopup',
      assign({ menus }, objectPick(bridge, ['ids', 'failedIds', 'injectInto'])));
  }
}

async function getDataFF(viaMessaging) {
  const data = window.vmData || await Promise.race([
    new Promise(resolve => { window.vmResolve = resolve; }),
    viaMessaging,
  ]);
  delete window.vmResolve;
  delete window.vmData;
  return data;
}
