import { dumpScriptValue, getUniqId, isEmpty } from '#/common/util';
import {
  assign, defineProperty, objectEntries, objectKeys, objectPick, objectValues,
} from '#/common/object';
import bridge from './bridge';
import store from './store';
import { onTabCreate } from './tabs';
import { atob, onRequestCreate } from './requests';
import { onNotificationCreate } from './notifications';
import {
  decodeValue, dumpValue, loadValues, changeHooks,
} from './gm-values';
import {
  Error, Uint8Array, charCodeAt, jsonDump, log, logging, slice, then,
  NS_HTML, appendChild, createElementNS, document, elemByTag, remove, setAttribute,
} from '../utils/helpers';

const {
  Blob, MouseEvent, TextDecoder,
  RegExp: { prototype: { test } },
  TextDecoder: { prototype: { decode: tdDecode } },
  URL: { createObjectURL, revokeObjectURL },
} = global;
const { findIndex, indexOf } = [];
const { lastIndexOf } = '';
const { dispatchEvent, getElementById } = document;
const { removeAttribute } = Element.prototype;

const vmOwnFuncToString = () => '[Violentmonkey property]';
export const vmOwnFunc = (func, toString) => {
  defineProperty(func, 'toString', { value: toString || vmOwnFuncToString });
  return func;
};
let downloadChain = Promise.resolve();

export function makeGmApi() {
  return [{
    GM_deleteValue(key) {
      const { id } = this;
      const values = loadValues(id);
      const oldRaw = values[key];
      delete values[key];
      // using `undefined` to match the documentation and TM for GM_addValueChangeListener
      dumpValue(id, key, undefined, null, oldRaw);
    },
    GM_getValue(key, def) {
      const raw = loadValues(this.id)[key];
      return raw ? decodeValue(raw) : def;
    },
    GM_listValues() {
      return objectKeys(loadValues(this.id));
    },
    GM_setValue(key, val) {
      const { id } = this;
      const raw = dumpScriptValue(val, jsonDump) || null;
      const values = loadValues(id);
      const oldRaw = values[key];
      values[key] = raw;
      dumpValue(id, key, val, raw, oldRaw);
    },
    /**
     * @callback GMValueChangeListener
     * @param {String} key
     * @param {?} oldValue - `undefined` means value was created
     * @param {?} newValue - `undefined` means value was removed
     * @param {boolean} remote - `true` means value was modified in another tab
     */
    /**
     * @param {String} key - name of the value to monitor
     * @param {GMValueChangeListener} fn - callback
     * @returns {String} listenerId
     */
    GM_addValueChangeListener(key, fn) {
      if (typeof key !== 'string') key = `${key}`;
      if (typeof fn !== 'function') return;
      const keyHooks = changeHooks[this.id] || (changeHooks[this.id] = {});
      const hooks = keyHooks[key] || (keyHooks[key] = {});
      const i = objectValues(hooks)::indexOf(fn);
      let listenerId = i >= 0 && objectKeys(hooks)[i];
      if (!listenerId) {
        listenerId = getUniqId('VMvc');
        hooks[listenerId] = fn;
      }
      return listenerId;
    },
    /**
     * @param {String} listenerId
     */
    GM_removeValueChangeListener(listenerId) {
      const keyHooks = changeHooks[this.id];
      if (!keyHooks) return;
      objectEntries(keyHooks)::findIndex(([key, hooks]) => {
        if (listenerId in hooks) {
          delete hooks[listenerId];
          if (isEmpty(hooks)) delete keyHooks[key];
          return true;
        }
      });
      if (isEmpty(keyHooks)) delete changeHooks[this.id];
    },
    GM_getResourceText(name) {
      return getResource(this, name);
    },
    GM_getResourceURL(name) {
      return getResource(this, name, true);
    },
    GM_registerMenuCommand(cap, func) {
      const { id } = this;
      const key = `${id}:${cap}`;
      store.commands[key] = func;
      bridge.post('RegisterMenu', [id, cap]);
      return cap;
    },
    GM_unregisterMenuCommand(cap) {
      const { id } = this;
      const key = `${id}:${cap}`;
      delete store.commands[key];
      bridge.post('UnregisterMenu', [id, cap]);
    },
    GM_download(arg1, name) {
      // not using ... as it calls Babel's polyfill that calls unsafe Object.xxx
      let opts = {};
      let onload;
      if (typeof arg1 === 'string') {
        opts = { url: arg1, name };
      } else if (arg1) {
        name = arg1.name;
        onload = arg1.onload;
        opts = objectPick(arg1, [
          'url',
          'headers',
          'timeout',
          'onerror',
          'onprogress',
          'ontimeout',
        ]);
      }
      if (!name || typeof name !== 'string') {
        throw new Error('Required parameter "name" is missing or not a string.');
      }
      assign(opts, {
        context: { name, onload },
        method: 'GET',
        responseType: 'blob',
        overrideMimeType: 'application/octet-stream',
        onload: downloadBlob,
      });
      return onRequestCreate(opts, this.id);
    },
    GM_xmlhttpRequest(opts) {
      return onRequestCreate(opts, this.id);
    },
    /**
     * Bypasses site's CSP for inline `style`, `link`, and `script`.
     * @param {Node} [parent]
     * @param {string} tag
     * @param {Object} [attributes]
     * @returns {HTMLElement} it also has .then() so it should be compatible with TM
     */
    GM_addElement: (parent, tag, attributes) => (
      typeof parent === 'string'
        ? webAddElement(undefined, parent, tag)
        : webAddElement(parent, tag, attributes)
    ),
    /**
     * Bypasses site's CSP for inline `style`.
     * @param {string} css
     * @returns {HTMLElement} it also has .then() so it should be compatible with TM and old VM
     */
    GM_addStyle: css => (
      webAddElement(undefined, 'style', { textContent: css }, getUniqId('VMst'))
    ),
    GM_openInTab(url, options) {
      const data = options && typeof options === 'object' ? options : {
        active: !options,
      };
      data.url = url;
      return onTabCreate(data);
    },
    GM_notification(text, title, image, onclick) {
      const options = typeof text === 'object' ? text : {
        text,
        title,
        image,
        onclick,
      };
      if (!options.text) {
        throw new Error('GM_notification: `text` is required!');
      }
      const id = onNotificationCreate(options);
      return {
        remove: vmOwnFunc(() => bridge.send('RemoveNotification', id)),
      };
    },
    GM_setClipboard(data, type) {
      bridge.post('SetClipboard', { data, type });
    },
    // using the native console.log so the output has a clickable link to the caller's source
    GM_log: logging.log,
  }, {
    // Greasemonkey4 API polyfill
    getResourceURL: { async: true },
    getValue: { async: true },
    deleteValue: { async: true },
    setValue: { async: true },
    listValues: { async: true },
    xmlHttpRequest: { alias: 'xmlhttpRequest' },
    notification: true,
    openInTab: true,
    registerMenuCommand: true,
    setClipboard: true,
    addStyle: true, // gm4-polyfill.js sets it anyway
    addElement: true, // TM sets it
  }];
}

function webAddElement(parent, tag, attributes, useId) {
  const id = useId || getUniqId('VMel');
  let el;
  // DOM error in content script can't be caught by a page-mode userscript so we rethrow it here
  let error = bridge.sendSync('AddElement', [tag, attributes, id]);
  if (!error) {
    try {
      el = document::getElementById(id);
      if (!parent && !/^(script|style|link|meta)$/i.test(tag)) {
        parent = elemByTag('body');
      }
      if (parent) {
        parent::appendChild(el);
      }
    } catch (e) {
      error = e.stack;
      el::remove();
    }
  }
  if (error) {
    throw new Error(error);
  }
  if (!useId) {
    if (attributes && 'id' in attributes) {
      el::setAttribute('id', attributes.id);
    } else {
      el::removeAttribute('id');
    }
  }
  /* A Promise polyfill is not actually necessary because DOM messaging is synchronous,
     but we keep it for compatibility with GM_addStyle in VM of 2017-2019
     https://github.com/violentmonkey/violentmonkey/issues/217
     as well as for GM_addElement in Tampermonkey. */
  defineProperty(el, 'then', {
    configurable: true,
    value(callback) {
      // prevent infinite resolve loop
      delete el.then;
      callback(el);
    },
  });
  return el;
}

function getResource(context, name, isBlob) {
  const key = context.resources[name];
  if (key) {
    let res = isBlob && context.urls[key];
    if (!res) {
      const raw = bridge.cache[context.pathMap[key] || key];
      if (raw) {
        const dataPos = raw::lastIndexOf(',');
        const bin = atob(dataPos < 0 ? raw : raw::slice(dataPos + 1));
        if (isBlob || /[\x80-\xFF]/::test(bin)) {
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i += 1) {
            bytes[i] = bin::charCodeAt(i);
          }
          if (isBlob) {
            const type = dataPos < 0 ? '' : raw::slice(0, dataPos);
            res = createObjectURL(new Blob([bytes], { type }));
            context.urls[key] = res;
          } else {
            res = new TextDecoder()::tdDecode(bytes);
          }
        } else { // pure ASCII
          res = bin;
        }
      } else if (isBlob) {
        res = key;
      }
    }
    return res;
  }
}

function downloadBlob(res) {
  const { context: { name, onload }, response } = res;
  const url = createObjectURL(response);
  const a = document::createElementNS(NS_HTML, 'a');
  a::setAttribute('href', url);
  if (name) a::setAttribute('download', name);
  downloadChain = downloadChain::then(async () => {
    a::dispatchEvent(new MouseEvent('click'));
    revokeBlobAfterTimeout(url);
    try { onload?.(res); } catch (e) { log('error', ['GM_download', 'callback'], e); }
    await bridge.send('SetTimeout', 100);
  });
}

async function revokeBlobAfterTimeout(url) {
  await bridge.send('SetTimeout', 3000);
  revokeObjectURL(url);
}
