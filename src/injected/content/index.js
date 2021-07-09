import { getUniqId, isEmpty } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import { objectKeys, objectPick } from '#/common/object';
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
let pendingSetPopup;

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
  const scriptData = IS_FIREFOX && Event.prototype.composedPath
    ? await getDataFF(dataPromise)
    : await dataPromise;
  // 1) bridge.post may be overridden in injectScripts
  // 2) cloneInto is provided by Firefox in content scripts to expose data to the page
  bridge.post = bindEvents(contentId, webId, bridge.onHandle, global.cloneInto);
  bridge.isFirefox = scriptData.isFirefox;
  bridge.injectInto = scriptData.injectInto;
  if (scriptData.scripts) injectScripts(contentId, webId, scriptData, isXml);
  isPopupShown = scriptData.isPopupShown;
  sendSetPopup();
  // scriptData is the successor of the two ways to request scripts in Firefox,
  // but it may not contain everything returned by `GetInjected`, for example `expose`.
  // Use the slower but more complete `injectData` to continue.
  const injectData = await dataPromise;
  if (injectData.expose) bridge.post('Expose');
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
  AddStyle(css) {
    const styleId = getUniqId('VMst');
    const style = document::createElementNS(NS_HTML, 'style');
    style::setAttribute('id', styleId);
    style::append(css);
    appendToRoot(style);
    return styleId;
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
    sendCmd('SetPopup', {
      menus,
      ...objectPick(bridge, ['ids', 'failedIds', 'injectInto']),
    });
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
