import { isPromise, sendCmd } from '#/common';
import { INJECT_PAGE, browser } from '#/common/consts';

const allowed = createNullObj();
const handlers = createNullObj();
const bgHandlers = createNullObj();
const onScripts = [];
const assignHandlers = (dest, src, force) => {
  if (force) {
    assign(dest, src);
  } else {
    onScripts.push(() => assign(dest, src));
  }
};
const allowCmd = (cmd, dataKey) => {
  (allowed[cmd] || (allowed[cmd] = createNullObj()))[dataKey] = true;
};

const bridge = {
  __proto__: null,
  ids: [], // all ids including the disabled ones for SetPopup
  runningIds: [],
  // userscripts running in the content script context are messaged via invokeGuest
  /** @type Number[] */
  invokableIds: [],
  failedIds: [],
  cache: createNullObj(),
  pathMaps: createNullObj(),
  onScripts,
  allowCmd,
  /**
   * Without `force` handlers will be added only when userscripts are about to be injected.
   * @param {Object.<string, MessageFromGuestHandler>} obj
   * @param {boolean} [force]
   */
  addHandlers(obj, force) {
    assignHandlers(handlers, obj, force);
  },
  /** { CommandName: true } will relay the request via sendCmd as is.
   * Without `force` handlers will be added only when userscripts are about to be injected. */
  addBackgroundHandlers(obj, force) {
    assignHandlers(bgHandlers, obj, force);
  },
  /**
   * @param {VMInjectedScript | VMScript} script
   */
  allowScript({ dataKey, meta }) {
    allowCmd('Run', dataKey);
    meta.grant::forEach(grant => {
      const gm = /^GM[._]/::regexpTest(grant) && grant::slice(3);
      if (grant === 'GM_xmlhttpRequest' || grant === 'GM.xmlHttpRequest' || gm === 'download') {
        allowCmd('AbortRequest', dataKey);
        allowCmd('HttpRequest', dataKey);
      } else if (grant === 'window.close') {
        allowCmd('TabClose', dataKey);
      } else if (grant === 'window.focus') {
        allowCmd('TabFocus', dataKey);
      } else if (gm === 'addElement' || gm === 'addStyle') {
        allowCmd('AddElement', dataKey);
      } else if (gm === 'setValue' || gm === 'deleteValue') {
        allowCmd('UpdateValue', dataKey);
      } else if (gm === 'notification') {
        allowCmd('Notification', dataKey);
        allowCmd('RemoveNotification', dataKey);
      } else if (gm === 'openInTab') {
        allowCmd('TabOpen', dataKey);
        allowCmd('TabClose', dataKey);
      } else if (gm === 'registerMenuCommand') {
        allowCmd('RegisterMenu', dataKey);
      } else if (gm === 'setClipboard') {
        allowCmd('SetClipboard', dataKey);
      } else if (gm === 'unregisterMenuCommand') {
        allowCmd('UnregisterMenu', dataKey);
      }
    });
  },
  // realm is provided when called directly via invokeHost
  async onHandle({ cmd, data, dataKey, node }, realm) {
    const handle = handlers[cmd];
    if (!handle || !allowed[cmd]?.[dataKey]) {
      throw new ErrorSafe(`[Violentmonkey] Invalid command: "${cmd}" on ${global.location.host}`);
    }
    const callbackId = data && getOwnProp(data, CALLBACK_ID);
    if (callbackId) {
      data = data.data;
    }
    let res = handle === true
      ? sendCmd(cmd, data)
      : node::handle(data, realm || INJECT_PAGE);
    if (res && isPromise(res)) {
      res = await res;
    }
    if (callbackId) {
      bridge.post('Callback', { id: callbackId, data: res }, realm);
    }
  },
};

export default bridge;

browser.runtime.onMessage.addListener(({ cmd, data }, src) => {
  const fn = bgHandlers[cmd];
  if (fn) fn(data, src);
});

/**
 * @callback MessageFromGuestHandler
 * @param {Object} [data]
 * @param {INJECT_CONTENT | INJECT_PAGE} realm -
 *   INJECT_CONTENT when the message is from the content script context,
 *   INJECT_PAGE otherwise. Make sure to specify the same realm when messaging
 *   the results back otherwise it won't reach the target script.
 */
