import { getUniqId } from '#/common';
import { INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import { bindEvents, sendMessage } from '../utils';
import {
  setJsonDump, objectKeys, filter, forEach, includes, append, createElement, setAttribute,
} from '../utils/helpers';
import bridge from './bridge';
import './clipboard';
import { injectScripts, triageScripts } from './inject';
import './notifications';
import './requests';
import './tabs';

const IS_TOP = window.top === window;
const menus = {};

// Make sure to call obj::method() in code that may run after INJECT_CONTENT userscripts
const { split } = String.prototype;

export default async function initialize(contentId, webId) {
  // may be overriden in injectScripts
  bridge.post = bindEvents(contentId, webId, bridge.onHandle);
  bridge.destId = webId;
  setJsonDump({ native: true });
  const data = await sendMessage({
    cmd: 'GetInjected',
    data: {
      url: window.location.href,
      reset: IS_TOP,
    },
  });
  const scriptLists = triageScripts(data);
  getPopup();
  setBadge();
  if (scriptLists[INJECT_PAGE].length || scriptLists[INJECT_CONTENT].length) {
    injectScripts(contentId, webId, data, scriptLists);
  }
}

bridge.addBackgroundHandlers({
  Command(data) {
    const id = +data::split(':', 1)[0];
    const realm = bridge.invokableIds::includes(id) && INJECT_CONTENT;
    bridge.post({ cmd: 'Command', data, realm });
  },
  GetPopup: getPopup,
  UpdatedValues(data) {
    const realms = [
      { data: {}, present: false },
      { data: {}, present: false, realm: INJECT_CONTENT },
    ];
    objectKeys(data)::forEach((id) => {
      const r = realms[bridge.invokableIds::includes(id) ? 1 : 0];
      r.data[id] = data[id];
      r.present = true;
    });
    realms
    ::filter(r => r.present)
    ::forEach(({ data: d, realm }) => {
      bridge.post({ cmd: 'UpdatedValues', data: d, realm });
    });
  },
});

bridge.addHandlers({
  UpdateValue: sendMessage,
  RegisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      let commandMap = menus[id];
      if (!commandMap) {
        commandMap = {};
        menus[id] = commandMap;
      }
      commandMap[cap] = 1;
    }
    getPopup();
  },
  UnregisterMenu(data) {
    if (IS_TOP) {
      const [id, cap] = data;
      const commandMap = menus[id];
      if (commandMap) {
        delete menus[cap];
      }
    }
    getPopup();
  },
  AddStyle({ css, callbackId }, realm) {
    const styleId = getUniqId('VMst');
    const style = document::createElement('style');
    style::setAttribute('id', styleId);
    style::append(css);
    // DOM spec allows any elements under documentElement
    // https://dom.spec.whatwg.org/#node-trees
    (document.head || document.documentElement)::append(style);
    bridge.post({ cmd: 'Callback', data: { callbackId, payload: styleId }, realm });
  },
  CheckScript({ name, namespace, callback }, realm) {
    sendMessage({ cmd: 'CheckScript', data: { name, namespace } })
    .then((result) => {
      bridge.post({ cmd: 'ScriptChecked', data: { callback, result }, realm });
    });
  },
});

function getPopup() {
  // XXX: only scripts run in top level window are counted
  if (IS_TOP) {
    sendMessage({
      cmd: 'SetPopup',
      data: { ids: bridge.ids, menus },
    });
  }
}

function setBadge() {
  // delay setBadge in frames so that they can be added to the initial count
  new Promise(resolve => setTimeout(resolve, IS_TOP ? 0 : 300))
  .then(() => sendMessage({
    cmd: 'SetBadge',
    data: {
      ids: bridge.enabledIds,
      reset: IS_TOP,
    },
  }));
}
