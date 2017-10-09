import { isFirefox } from 'src/common/ua';
import { getUniqId } from 'src/common';
import { bindEvents, sendMessage, inject, attachFunction } from '../utils';
import bridge from './bridge';
import { tabOpen, tabClose, tabClosed } from './tabs';
import { onNotificationCreate, onNotificationClick, onNotificationClose } from './notifications';
import { getRequestId, httpRequest, abortRequest, httpRequested } from './requests';
import dirtySetClipboard from './clipboard';

const IS_TOP = window.top === window;

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
    if (IS_TOP) sendMessage({ cmd: 'SetBadge', data: badge.number });
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
  UpdatedValues(data) {
    bridge.post({ cmd: 'UpdatedValues', data });
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

  sendMessage({ cmd: 'GetInjected', data: window.location.href })
  .then(data => {
    if (data.scripts) {
      data.scripts.forEach(script => {
        ids.push(script.props.id);
        if (script.config.enabled) badge.number += 1;
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
  UpdateValue(data) {
    sendMessage({ cmd: 'UpdateValue', data });
  },
  RegisterMenu(data) {
    if (IS_TOP) menus.push(data);
    getPopup();
  },
  AddStyle({ css, callbackId }) {
    let styleId = null;
    if (document.head) {
      styleId = getUniqId('VMst');
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      document.head.appendChild(style);
    }
    bridge.post({ cmd: 'Callback', data: { callbackId, payload: styleId } });
  },
  Notification: onNotificationCreate,
  SetClipboard(data) {
    if (isFirefox) {
      // Firefox does not support copy from background page.
      // ref: https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Interact_with_the_clipboard
      // The dirty way will create a <textarea> element in web page and change the selection.
      dirtySetClipboard(data);
    } else {
      sendMessage({ cmd: 'SetClipboard', data });
    }
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
  if (IS_TOP) {
    sendMessage({
      cmd: 'SetPopup',
      data: { ids, menus },
    });
  }
}

function injectScript(data) {
  const [vId, wrapperKeys, code, vCallbackId] = data;
  const func = (attach, id, cb, callbackId) => {
    attach(id, cb);
    const callback = window[callbackId];
    if (callback) callback();
  };
  const args = [
    attachFunction.toString(),
    JSON.stringify(vId),
    `function(${wrapperKeys.join(',')}){${code}}`,
    JSON.stringify(vCallbackId),
  ];
  inject(`!${func.toString()}(${args.join(',')})`);
}
