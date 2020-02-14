import { cache2blobUrl, getUniqId, isEmpty } from '#/common';
import { downloadBlob } from '#/common/download';
import { objectPick } from '#/common/object';
import bridge from './bridge';
import store from './store';
import { onTabCreate } from './tabs';
import { onRequestCreate } from './requests';
import { onNotificationCreate } from './notifications';
import {
  decodeValue, dumpValue, loadValues, changeHooks,
} from './gm-values';
import {
  findIndex, indexOf, slice, defineProperty, objectKeys, objectValues, objectEntries,
  atob, Error, jsonDump, logging, utf8decode,
} from '../utils/helpers';

const { getElementById } = Document.prototype;
const { lastIndexOf } = String.prototype;

const vmOwnFuncToString = () => '[Violentmonkey property]';
export const vmOwnFunc = (func, toString) => {
  defineProperty(func, 'toString', { value: toString || vmOwnFuncToString });
  return func;
};

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
      const dumped = jsonDump(val);
      const raw = dumped ? `o${dumped}` : null;
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
      if (name in this.resources) {
        const key = this.resources[name];
        const raw = store.cache[this.pathMap[key] || key];
        if (!raw) return;
        const i = raw::lastIndexOf(',');
        const lastPart = i < 0 ? raw : raw::slice(i + 1);
        return utf8decode(atob(lastPart));
      }
    },
    GM_getResourceURL(name) {
      if (name in this.resources) {
        const key = this.resources[name];
        let blobUrl = this.urls[key];
        if (!blobUrl) {
          const raw = store.cache[this.pathMap[key] || key];
          if (raw) {
            blobUrl = cache2blobUrl(raw);
            this.urls[key] = blobUrl;
          } else {
            blobUrl = key;
          }
        }
        return blobUrl;
      }
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
      const opts = typeof arg1 === 'string' ? { url: arg1, name } : arg1;
      if (!opts || !opts.url) throw new Error('GM_download: Invalid parameter!');
      return onRequestCreate({
        method: 'GET',
        responseType: 'blob',
        overrideMimeType: 'application/octet-stream',
        onload: res => downloadBlob(res.response, opts.name, () => opts.onload?.(res)),
        ...objectPick(opts, [
          'url',
          'headers',
          'timeout',
          'onerror',
          'onprogress',
          'ontimeout',
        ]),
      }, this.id);
    },
    GM_xmlhttpRequest(opts) {
      if (!opts || !opts.url) throw new Error('GM_xmlhttpRequest: Invalid parameter!');
      return onRequestCreate(opts, this.id);
    },
    GM_addStyle(css) {
      const id = bridge.sendSync('AddStyle', css);
      const el = document::getElementById(id);
      // Mock a Promise without the need for polyfill
      // It's not actually necessary because DOM messaging is synchronous
      // but we keep it for compatibility with VM's 2017-2019 behavior
      // https://github.com/violentmonkey/violentmonkey/issues/217
      el.then = callback => {
        // prevent infinite resolve loop
        delete el.then;
        callback(el);
      };
      return el;
    },
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
    setClipboard: true,
    addStyle: true, // gm4-polyfill.js sets it anyway
  }];
}
