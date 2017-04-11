import base from './bridge';
import { getRequestId, httpRequest, abortRequest } from './requests';
import { inject, postData, sendMessage, noop } from './utils';
import { onNotificationCreate } from './notification';
import { tabOpen, tabClose } from './tabs';

const ids = [];
const menus = [];

const bridge = Object.assign({
  initialize,
  getPopup,
  ids,
  menus,
  handle: handleContent,
}, base);

export default bridge;

function getPopup() {
  // XXX: only scripts run in top level window are counted
  if (top === window) {
    sendMessage({
      cmd: 'SetPopup',
      data: { ids, menus },
    })
    .catch(noop);
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

function handleContent(req) {
  if (!req) {
    console.error('[Violentmonkey] Invalid data! There might be unsupported data format.');
    return;
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
  };
  const handle = handlers[req.cmd];
  if (handle) handle(req.data);
}

function initialize(src, dest) {
  bridge.bindEvents(src, dest);
}
