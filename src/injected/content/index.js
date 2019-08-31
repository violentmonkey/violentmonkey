import { isFirefox } from '#/common/ua';
import { getUniqId } from '#/common';
import { INJECT_PAGE, INJECT_CONTENT, INJECT_AUTO } from '#/common/consts';
import {
  bindEvents, sendMessage, attachFunction,
} from '../utils';
import bridge from './bridge';
import { tabOpen, tabClose, tabClosed } from './tabs';
import { onNotificationCreate, onNotificationClick, onNotificationClose } from './notifications';
import {
  getRequestId, httpRequest, abortRequest, httpRequested,
} from './requests';
import dirtySetClipboard from './clipboard';
import { inject } from './util';

const IS_TOP = window.top === window;

// Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
const VMInitInjection = window[process.env.INIT_FUNC_NAME];

const ids = [];
const enabledIds = [];
const menus = {};

function setBadge() {
  // delay setBadge in frames so that they can be added to the initial count
  new Promise(resolve => setTimeout(resolve, IS_TOP ? 0 : 300))
  .then(() => sendMessage({
    cmd: 'SetBadge',
    data: {
      ids: enabledIds,
      reset: IS_TOP,
    },
  }));
}

const bgHandlers = {
  Command(data) {
    bridge.post({ cmd: 'Command', data });
  },
  GetPopup: getPopup,
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

  return sendMessage({
    cmd: 'GetInjected',
    data: {
      url: window.location.href,
      reset: IS_TOP,
    },
  })
  .then((data) => {
    const scriptLists = {
      [INJECT_PAGE]: [],
      [INJECT_CONTENT]: [],
    };
    if (data.scripts) {
      data.scripts = data.scripts.filter((script) => {
        ids.push(script.props.id);
        if ((IS_TOP || !script.meta.noframes) && script.config.enabled) {
          enabledIds.push(script.props.id);
          return true;
        }
        return false;
      });
      let support;
      data.scripts.forEach((script) => {
        let injectInto = script.custom.injectInto || script.meta.injectInto || data.injectInto;
        if (injectInto === INJECT_AUTO) {
          if (!support) support = { injectable: checkInjectable() };
          injectInto = support.injectable ? INJECT_PAGE : INJECT_CONTENT;
        }
        const list = scriptLists[injectInto];
        if (list) list.push(script);
      });
    }
    getPopup();
    setBadge();
    if (scriptLists[INJECT_PAGE].length || scriptLists[INJECT_CONTENT].length) {
      injectScripts(contentId, webId, data, scriptLists);
    }
  });
}

function checkInjectable() {
  // Check default namespace, `a.style` only exists in HTML namespace
  if (!('style' in document.createElement('a'))) return false;
  const id = getUniqId('VM-');
  const detect = (domId) => {
    const a = document.createElement('a');
    a.id = domId;
    document.documentElement.appendChild(a);
  };
  inject(`(${detect.toString()})(${JSON.stringify(id)})`);
  const a = document.querySelector(`#${id}`);
  const injectable = !!a;
  if (a) a.parentNode.removeChild(a);
  return injectable;
}

function injectScripts(contentId, webId, data, scriptLists) {
  const props = {};
  [
    Object.getOwnPropertyNames(window),
    Object.getOwnPropertyNames(global),
  ].forEach((keys) => {
    keys.forEach((key) => { props[key] = 1; });
  });
  const args = [
    webId,
    contentId,
    Object.keys(props),
  ];

  const injectPage = scriptLists[INJECT_PAGE];
  const injectContent = scriptLists[INJECT_CONTENT];
  if (injectContent.length) {
    VMInitInjection()(...args, INJECT_CONTENT);
    bridge.ready.then(() => {
      bridge.post({
        cmd: 'LoadScripts',
        data: {
          ...data,
          mode: INJECT_CONTENT,
          scripts: injectContent,
        },
      });
    });
  }
  if (injectPage.length) {
    // Avoid using Function::apply in case it is shimmed
    inject(`(${VMInitInjection.toString()}())(${args.map(arg => JSON.stringify(arg)).join(',')})`);
    bridge.ready.then(() => {
      bridge.post({
        cmd: 'LoadScripts',
        data: {
          ...data,
          mode: INJECT_PAGE,
          scripts: injectPage,
        },
      });
    });
  }
}

const handlers = {
  GetRequestId: getRequestId,
  HttpRequest: httpRequest,
  AbortRequest: abortRequest,
  Inject: injectScript,
  TabOpen: tabOpen,
  TabClose: tabClose,
  Ready() {
    bridge.ready = Promise.resolve();
  },
  UpdateValue(data) {
    sendMessage({ cmd: 'UpdateValue', data });
  },
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
    .then((result) => {
      bridge.post({ cmd: 'ScriptChecked', data: { callback, result } });
    });
  },
};

bridge.ready = new Promise((resolve) => {
  handlers.Ready = resolve;
});

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
  const [vId, code, vCallbackId, mode, scriptId] = data;
  const func = (attach, id, cb, callbackId) => {
    attach(id, cb);
    const callback = window[callbackId];
    if (callback) callback();
  };
  const args = [
    attachFunction.toString(),
    JSON.stringify(vId),
    code,
    JSON.stringify(vCallbackId),
  ];
  const injectedCode = `!${func.toString()}(${args.join(',')})`;
  if (mode === INJECT_CONTENT) {
    sendMessage({
      cmd: 'InjectScript',
      data: injectedCode,
    });
  } else {
    inject(injectedCode, browser.extension.getURL(`/options/index.html#scripts/${scriptId}`));
  }
}
