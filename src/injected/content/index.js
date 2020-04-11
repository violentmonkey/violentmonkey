import { getUniqId, isEmpty } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import { objectKeys } from '#/common/object';
import { bindEvents, sendCmd } from '../utils';
import {
  forEach, includes, append, createElementNS, setAttribute, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';
import './clipboard';
import { appendToRoot, injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';

const IS_FIREFOX = !global.chrome.app;
const IS_TOP = window.top === window;
const menus = {};
let isPopupShown;

// Make sure to call obj::method() in code that may run after INJECT_CONTENT userscripts
const { split } = String.prototype;

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
  bridge.isFirefox = data.isFirefox;
  if (data.scripts) injectScripts(contentId, webId, data, isXml);
  if (data.expose) bridge.post('Expose');
  isPopupShown = data.isPopupShown;
  sendSetPopup();
})().catch(IS_FIREFOX && console.error); // Firefox can't show exceptions in content scripts

bridge.addBackgroundHandlers({
  Command(data) {
    const id = +data::split(':', 1)[0];
    const realm = bridge.invokableIds::includes(id) && INJECT_CONTENT;
    bridge.post('Command', data, realm);
  },
  PopupShown(state) {
    isPopupShown = state;
    sendSetPopup();
  },
  UpdatedValues(data) {
    const dataPage = {};
    const dataContent = {};
    const { invokableIds } = bridge;
    objectKeys(data)::forEach((id) => {
      (invokableIds::includes(id) ? dataContent : dataPage)[id] = data[id];
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
      sendSetPopup();
    }
  },
  UnregisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      delete menus[id]?.[cap];
      sendSetPopup();
    }
  },
  AddStyle(css) {
    const styleId = getUniqId('VMst');
    const style = document::createElementNS(NS_HTML, 'style');
    style::setAttribute('id', styleId);
    style::append(css);
    appendToRoot(style);
    return styleId;
  },
  CheckScript: sendCmd,
});

function sendSetPopup() {
  if (isPopupShown) {
    sendCmd('SetPopup', { ids: bridge.ids, menus });
  }
}

async function getDataFF(viaMessaging) {
  const data = await Promise.race([
    new Promise(resolve => { global.resolveData = resolve; }),
    viaMessaging,
  ]);
  delete global.resolveData;
  return data;
}
