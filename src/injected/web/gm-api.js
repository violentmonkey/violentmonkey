import { cache2blobUrl, getUniqId } from '#/common';
import { downloadBlob } from '#/common/download';
import bridge from './bridge';
import store from './store';
import { onTabCreate } from './tabs';
import { onRequestCreate } from './requests';
import { onNotificationCreate } from './notifications';
import {
  decodeValue, dumpValue, loadValues, changeHooks,
} from './gm-values';
import {
  findIndex, indexOf, slice, objectKeys, objectValues, objectEntries,
  atob, Error, jsonDump, logging, utf8decode, Blob,
} from '../utils/helpers';

const { getElementById } = Document.prototype;
const { lastIndexOf } = String.prototype;
const { hasOwnProperty } = Object.prototype;

export function createGmApiProps() {
  // these are bound to script data that we pass via |this|
  const boundProps = {
    GM_deleteValue(key) {
      const { id } = this;
      const values = loadValues(id);
      const oldRaw = values[key];
      delete values[key];
      dumpValue({
        id, key, oldRaw,
      });
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
      dumpValue({
        id, key, val, raw, oldRaw,
      });
    },
    /**
     * @callback GMValueChangeListener
     * @param {String} key
     * @param {any} oldValue - undefined = value was created
     * @param {any} newValue - undefined = value was removed
     * @param {boolean} remote - true = value was modified in another tab
     */
    /**
     * @param {String} key - name of the value to monitor
     * @param {GMValueChangeListener} fn - callback
     * @returns {String} listenerId
     */
    GM_addValueChangeListener(key, fn) {
      if (typeof key !== 'string') key = `${key}`;
      if (typeof fn !== 'function') return;
      let keyHooks = changeHooks[this.id];
      if (!keyHooks) {
        keyHooks = {};
        changeHooks[this.id] = keyHooks;
      }
      let hooks = keyHooks[key];
      if (!hooks) {
        hooks = {};
        keyHooks[key] = hooks;
      }
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
        const raw = this.cache[this.pathMap[key] || key];
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
          const raw = this.cache[this.pathMap[key] || key];
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
      bridge.post({ cmd: 'RegisterMenu', data: [id, cap] });
    },
    GM_unregisterMenuCommand(cap) {
      const { id } = this;
      const key = `${id}:${cap}`;
      delete store.commands[key];
      bridge.post({ cmd: 'UnregisterMenu', data: [id, cap] });
    },
    GM_download(arg1, name) {
      const opts = typeof arg1 === 'string' ? { url: arg1, name } : arg1;
      if (!opts || !opts.url) throw new Error('GM_download: Invalid parameter!');
      return onRequestCreate({
        method: 'GET',
        responseType: 'arraybuffer',
        url: opts.url,
        headers: opts.headers,
        timeout: opts.timeout,
        onerror: opts.onerror,
        onprogress: opts.onprogress,
        ontimeout: opts.ontimeout,
        onload(res) {
          const blob = new Blob([res.response], { type: 'application/octet-stream' });
          downloadBlob(blob, opts.name, opts.onload);
        },
      }, this.id);
    },
    GM_xmlhttpRequest(opts) {
      if (!opts || !opts.url) throw new Error('GM_xmlhttpRequest: Invalid parameter!');
      return onRequestCreate(opts, this.id);
    },
  };

  const props = {
    GM_addStyle(css) {
      let el = false;
      const callbackId = registerCallback((styleId) => {
        el = document::getElementById(styleId);
      });
      bridge.post({ cmd: 'AddStyle', data: { css, callbackId } });
      // Mock a Promise without the need for polyfill
      // It's not actually necessary because DOM messaging is synchronous
      // but we keep it for compatibility with VM's 2017-2019 behavior
      // https://github.com/violentmonkey/violentmonkey/issues/217
      el.then = callback => callback(el);
      return el;
    },
    GM_log: logging.log,
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
      onNotificationCreate(options);
    },
    GM_setClipboard(data, type) {
      bridge.post({
        cmd: 'SetClipboard',
        data: { type, data },
      });
    },
  };
  // convert to object property descriptors
  [props, boundProps].forEach(target => {
    objectKeys(target).forEach(k => {
      target[k] = propertyFromValue(target[k]);
    });
  });
  return {
    props,
    boundProps,
    gm4: {
      getResourceURL: { async: true },
      getValue: { async: true },
      deleteValue: { async: true },
      setValue: { async: true },
      listValues: { async: true },
      xmlHttpRequest: { alias: 'xmlhttpRequest' },
      notification: true,
      openInTab: true,
      setClipboard: true,
    },
  };
}

export function propertyFromValue(value) {
  const prop = {
    writable: false,
    configurable: false,
    value,
  };
  if (typeof value === 'function') value.toString = propertyToString;
  return prop;
}

function propertyToString() {
  return '[Violentmonkey property]';
}

function registerCallback(callback) {
  const callbackId = getUniqId('VMcb');
  store.callbacks[callbackId] = (payload) => {
    callback(payload);
    delete store.callbacks[callbackId];
  };
  return callbackId;
}

function isEmpty(obj) {
  for (const key in obj) {
    if (obj::hasOwnProperty(key)) {
      return false;
    }
  }
  return true;
}
