import { INJECT_PAGE, browser } from '../util';
import { sendCmd } from './util-content';

const allowed = createNullObj();
const dataKeyNameMap = createNullObj();
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
  ensureNestedProp(allowed, cmd, dataKey, true);
};
const XHR = ['HttpRequest', 'AbortRequest'];
const ADD_ELEMENT = ['AddElement'];
const UPDATE_VALUE = ['UpdateValue'];
const TAB_CLOSE = ['TabClose'];
const GET_RESOURCE = ['GetResource'];
const GM_CMD = {
  __proto__: null,
  addElement: ADD_ELEMENT,
  addStyle: ADD_ELEMENT,
  deleteValue: UPDATE_VALUE,
  download: XHR,
  getResourceText: GET_RESOURCE,
  getResourceURL: GET_RESOURCE, // also allows the misspelled GM.getResourceURL for compatibility
  notification: ['Notification', 'RemoveNotification'],
  openInTab: ['TabOpen', TAB_CLOSE],
  registerMenuCommand: ['RegisterMenu'],
  setClipboard: ['SetClipboard'],
  setValue: UPDATE_VALUE,
  unregisterMenuCommand: ['UnregisterMenu'],
};
const GRANT_CMD = {
  __proto__: null,
  'GM.getResourceUrl': GET_RESOURCE,
  'GM.xmlHttpRequest': XHR,
  'GM_xmlhttpRequest': XHR, // eslint-disable-line quote-props
  [WINDOW_CLOSE]: TAB_CLOSE,
  [WINDOW_FOCUS]: ['TabFocus'],
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
    dataKeyNameMap[dataKey] = meta.name;
    meta.grant::forEach(grant => {
      const cmds = GRANT_CMD[grant]
        || /^GM[._]/::regexpTest(grant) && GM_CMD[grant::slice(3)];
      if (cmds) cmds::forEach(cmd => allowCmd(cmd, dataKey));
    });
  },
  // realm is provided when called directly via invokeHost
  async onHandle({ cmd, data, dataKey, node }, realm) {
    const handle = handlers[cmd];
    if (!handle || !allowed[cmd]?.[dataKey]) {
      // TODO: maybe remove this check if our VAULT is reliable
      log('info', null, `Invalid command: "${cmd}" from "${dataKeyNameMap[dataKey] || '?'}"`);
    }
    const callbackId = data && getOwnProp(data, CALLBACK_ID);
    if (callbackId) {
      data = data.data;
    }
    let res = handle === true
      ? sendCmd(cmd, data)
      : node::handle(data, realm || INJECT_PAGE);
    if (isPromise(res)) {
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
