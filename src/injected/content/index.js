import { bindEvents, sendMessage, postData, inject } from '../utils';
import bridge from './bridge';
import { tabOpen, tabClose, tabClosed } from './tabs';
import { onNotificationCreate, onNotificationClick, onNotificationClose } from './notifications';
import { getRequestId, httpRequest, abortRequest, httpRequested } from './requests';

const ids = [];
const menus = [];

const badge = {
  number: 0,
  ready: false,
  willSet: false,
};

function getBadge() {
  badge.willSet = true;
  setBadge();
}

function setBadge() {
  if (badge.ready && badge.willSet) {
    // XXX: only scripts run in top level window are counted
    if (top === window) sendMessage({ cmd: 'SetBadge', data: badge.number });
  }
}

const bgHandlers = {
  Command(data) {
    bridge.post({ cmd: 'Command', data });
  },
  GetPopup: getPopup,
  GetBadge: getBadge,
  HttpRequested: httpRequested,
  TabClosed: tabClosed,
  UpdateValues(data) {
    bridge.post({ cmd: 'UpdateValues', data });
  },
  NotificationClick: onNotificationClick,
  NotificationClose: onNotificationClose,
};

export default function initialize(contentId, webId) {
  bridge.post = bindEvents(contentId, webId, onHandle);
  bridge.destId = webId;

  browser.runtime.onMessage.addListener((req, src) => {
    const handle = bgHandlers[req.cmd];
    if (handle) handle(req.data, src);
  });

  sendMessage({ cmd: 'GetInjected', data: location.href })
  .then(data => {
    if (data.scripts) {
      data.scripts.forEach(script => {
        ids.push(script.id);
        if (script.enabled) badge.number += 1;
      });
    }
    bridge.post({ cmd: 'LoadScripts', data });
    badge.ready = true;
    getPopup();
    setBadge();
  });
}

const handlers = {
  GetRequestId: getRequestId,
  HttpRequest: httpRequest,
  AbortRequest: abortRequest,
  Inject: injectScript,
  TabOpen: tabOpen,
  TabClose: tabClose,
  SetValue(data) {
    sendMessage({ cmd: 'SetValue', data });
  },
  RegisterMenu(data) {
    if (window.top === window) menus.push(data);
    getPopup();
  },
  AddStyle(css) {
    if (document.head) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }
  },
  Notification: onNotificationCreate,
  SetClipboard(data) {
    sendMessage({ cmd: 'SetClipboard', data });
  },
  CheckScript({ name, namespace, callback }) {
    sendMessage({ cmd: 'CheckScript', data: { name, namespace } })
    .then(result => {
      bridge.post({ cmd: 'ScriptChecked', data: { callback, result } });
    });
  },
};

function onHandle(req) {
  const handle = handlers[req.cmd];
  if (handle) handle(req.data);
}

function getPopup() {
  // XXX: only scripts run in top level window are counted
  if (top === window) {
    sendMessage({
      cmd: 'SetPopup',
      data: { ids, menus },
    });
  }
}

function injectScript(data) {
  const [id, wrapperKeys, code] = data;
  const func = (scriptId, cb, post, destId) => {
    Object.defineProperty(window, `VM_${scriptId}`, {
      value: cb,
      configurable: true,
    });
    post(destId, { cmd: 'Injected', data: scriptId });
  };
  const args = [
    JSON.stringify(id),
    `function(${wrapperKeys.join(',')}){${code}}`,
    postData.toString(),
    JSON.stringify(bridge.destId),
  ];
  inject(`!${func.toString()}(${args.join(',')})`);
}
