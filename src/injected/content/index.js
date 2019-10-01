import { isFirefox } from '#/common/ua';
import { getUniqId } from '#/common';
import { INJECT_PAGE, INJECT_CONTENT, INJECT_AUTO } from '#/common/consts';
import {
  bindEvents, sendMessage, attachFunction, setJsonDump, jsonDump,
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
delete window[process.env.INIT_FUNC_NAME];

const ids = [];
const enabledIds = [];
const menus = {};
// userscripts running in the content script context are messaged via invokeGuest
const invokableIds = [];

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
    const id = +data.split(':', 1)[0];
    const realm = invokableIds.includes(id) && INJECT_CONTENT;
    bridge.post({ cmd: 'Command', data, realm });
  },
  GetPopup: getPopup,
  HttpRequested: httpRequested,
  TabClosed: tabClosed,
  UpdatedValues(data) {
    const realms = [
      { data: {}, present: false },
      { data: {}, present: false, realm: INJECT_CONTENT },
    ];
    Object.keys(data).forEach((id) => {
      const r = realms[invokableIds.includes(id) ? 1 : 0];
      r.data[id] = data[id];
      r.present = true;
    });
    realms
    .filter(r => r.present)
    .forEach(({ data: d, realm }) => {
      bridge.post({ cmd: 'UpdatedValues', data: d, realm });
    });
  },
  NotificationClick: onNotificationClick,
  NotificationClose: onNotificationClose,
};

export default function initialize(contentId, webId) {
  // may be overriden in injectScripts
  bridge.post = bindEvents(contentId, webId, onHandle);
  bridge.destId = webId;

  browser.runtime.onMessage.addListener((req, src) => {
    const handle = bgHandlers[req.cmd];
    if (handle) handle(req.data, src);
  });

  setJsonDump({ native: true });

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
  inject(`(${detect})(${jsonDump(id)})`);
  const a = document.querySelector(`#${id}`);
  const injectable = !!a;
  if (a) a.parentNode.removeChild(a);
  return injectable;
}

function injectScripts(contentId, webId, data, scriptLists) {
  const props = Object.getOwnPropertyNames(window);
  // combining directly to avoid GC due to a big intermediate object as there are thousands of props
  Object.getOwnPropertyNames(global).forEach(key => !props.includes(key) && props.push(key));
  const args = [
    webId,
    contentId,
    props,
    isFirefox,
  ];

  const injectPage = scriptLists[INJECT_PAGE];
  const injectContent = scriptLists[INJECT_CONTENT];
  if (injectContent.length) {
    const invokeGuest = VMInitInjection()(...args, onHandle);
    const postViaBridge = bridge.post;
    invokableIds.push(...injectContent.map(script => script.props.id));
    bridge.post = msg => (
      msg.realm === INJECT_CONTENT
        ? invokeGuest(msg)
        : postViaBridge(msg)
    );
    bridge.post({
      cmd: 'LoadScripts',
      data: {
        ...data,
        mode: INJECT_CONTENT,
        scripts: injectContent,
      },
      realm: INJECT_CONTENT,
    });
  }
  if (injectPage.length) {
    // Avoid using Function::apply in case it is shimmed
    inject(`(${VMInitInjection}())(${jsonDump(args).slice(1, -1)})`);
    bridge.post.asString = isFirefox;
    bridge.post({
      cmd: 'LoadScripts',
      data: {
        ...data,
        mode: INJECT_PAGE,
        scripts: injectPage,
      },
    });
  }
  if (injectContent.length) {
    // content script userscripts will run in one of the next event loop cycles
    // (we use browser.tabs.executeScript) so we need to switch to jsonDumpSafe because
    // after this point we can't rely on JSON.stringify anymore, see the notes for setJsonDump
    setJsonDump({ native: false });
  }
}

/**
 * @callback MessageFromGuestHandler
 * @param {Object} [data]
 * @param {INJECT_CONTENT | INJECT_PAGE} realm -
 *   INJECT_CONTENT when the message is from the content script context,
 *   INJECT_PAGE otherwise. Make sure to specify the same realm when messaging
 *   the results back otherwise it won't reach the target script.
 */
/** @type {Object.<string, MessageFromGuestHandler>} */
const handlers = {
  GetRequestId: getRequestId,
  HttpRequest: httpRequest,
  AbortRequest: abortRequest,
  Inject: injectScript,
  InjectMulti: data => data.forEach(injectScript),
  TabOpen: tabOpen,
  TabClose: tabClose,
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
  AddStyle({ css, callbackId }, realm) {
    const styleId = getUniqId('VMst');
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    // DOM spec allows any elements under documentElement
    // https://dom.spec.whatwg.org/#node-trees
    (document.head || document.documentElement).appendChild(style);
    bridge.post({ cmd: 'Callback', data: { callbackId, payload: styleId }, realm });
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
  CheckScript({ name, namespace, callback }, realm) {
    sendMessage({ cmd: 'CheckScript', data: { name, namespace } })
    .then((result) => {
      bridge.post({ cmd: 'ScriptChecked', data: { callback, result }, realm });
    });
  },
};

// realm is provided when called directly via invokeHost
function onHandle(req, realm) {
  const handle = handlers[req.cmd];
  if (handle) handle(req.data, realm || INJECT_PAGE);
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

const injectedScriptIntro = `(${
  (attach, id, cb, callbackId) => {
    attach(id, cb);
    const callback = window[callbackId];
    if (callback) callback();
  }
})(${attachFunction},`;

function injectScript(data) {
  const [vId, codeSlices, vCallbackId, mode, scriptId] = data;
  // trying to avoid string concatenation of potentially huge code slices as long as possible
  const injectedCode = [
    injectedScriptIntro,
    `"${vId}"`, ',',
    ...codeSlices, ',',
    `"${vCallbackId}");`,
  ];
  if (mode === INJECT_CONTENT) {
    sendMessage({
      cmd: 'InjectScript',
      data: injectedCode.join(''),
    });
  } else {
    inject(injectedCode, browser.extension.getURL(`/options/index.html#scripts/${scriptId}`));
  }
}
