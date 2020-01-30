import { getUniqId, makePause, isEmpty } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import { bindEvents, sendCmd, sendMessage } from '../utils';
import {
  objectKeys, forEach, includes, append, createElementNS, setAttribute, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';
import './clipboard';
import { injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';

const IS_TOP = window.top === window;
const menus = {};

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
  const data = await dataPromise;
  // 1) bridge.post may be overridden in injectScripts
  // 2) cloneInto is provided by Firefox in content scripts to expose data to the page
  bridge.post = bindEvents(contentId, webId, bridge.onHandle, global.cloneInto);
  bridge.isFirefox = data.isFirefox;
  if (data.scripts) injectScripts(contentId, webId, data, isXml);
  getPopup();
  setBadge();
})();

bridge.addBackgroundHandlers({
  Command(data) {
    const id = +data::split(':', 1)[0];
    const realm = bridge.invokableIds::includes(id) && INJECT_CONTENT;
    bridge.post('Command', data, realm);
  },
  GetPopup: getPopup,
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
  UpdateValue: sendMessage,
  RegisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      const commandMap = menus[id] || (menus[id] = {});
      commandMap[cap] = 1;
    }
    getPopup();
  },
  UnregisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      delete menus[id]?.[cap];
    }
    getPopup();
  },
  AddStyle({ css, callbackId }, realm) {
    const styleId = getUniqId('VMst');
    const style = document::createElementNS(NS_HTML, 'style');
    style::setAttribute('id', styleId);
    style::append(css);
    // DOM spec allows any elements under documentElement
    // https://dom.spec.whatwg.org/#node-trees
    (document.head || document.documentElement)::append(style);
    bridge.post('Callback', { callbackId, payload: styleId }, realm);
  },
  async CheckScript({ name, namespace, callback }, realm) {
    const result = await sendCmd('CheckScript', { name, namespace });
    bridge.post('ScriptChecked', { callback, result }, realm);
  },
});

function getPopup() {
  sendCmd('SetPopup', { ids: bridge.ids, menus });
}

async function setBadge() {
  // delay setBadge in frames so that they can be added to the initial count
  if (!IS_TOP) await makePause(300);
  sendCmd('SetBadge', bridge.enabledIds);
}
