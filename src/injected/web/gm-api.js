import { dumpScriptValue, isEmpty, isFunction } from '#/common/util';
import bridge from './bridge';
import store from './store';
import { onTabCreate } from './tabs';
import { onRequestCreate } from './requests';
import { onNotificationCreate } from './notifications';
import { decodeValue, dumpValue, loadValues, changeHooks } from './gm-values';
import { jsonDump } from './util-web';

export function makeGmApi() {
  return {
    __proto__: null,
    GM_deleteValue(key) {
      const { id } = this;
      const values = loadValues(id);
      const oldRaw = values[key];
      delete values[key];
      // using `undefined` to match the documentation and TM for GM_addValueChangeListener
      dumpValue(id, key, undefined, null, oldRaw, this);
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
      dumpValue(id, key, val, raw, oldRaw, this);
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
      const keyHooks = changeHooks[this.id] || (changeHooks[this.id] = createNullObj());
      const hooks = keyHooks[key] || (keyHooks[key] = createNullObj());
      const i = objectValues(hooks)::indexOf(fn);
      let listenerId = i >= 0 && objectKeys(hooks)[i];
      if (!listenerId) {
        listenerId = getUniqIdSafe('VMvc');
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
      for (const key in keyHooks) { /* proto is null */// eslint-disable-line guard-for-in
        const hooks = keyHooks[key];
        if (listenerId in hooks) {
          delete hooks[listenerId];
          if (isEmpty(hooks)) delete keyHooks[key];
          break;
        }
      }
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
      bridge.post('RegisterMenu', { id, cap }, this);
      return cap;
    },
    GM_unregisterMenuCommand(cap) {
      const { id } = this;
      const key = `${id}:${cap}`;
      delete store.commands[key];
      bridge.post('UnregisterMenu', { id, cap }, this);
    },
    GM_download(arg1, name) {
      // not using ... as it calls Babel's polyfill that calls unsafe Object.xxx
      const opts = createNullObj();
      let onload;
      if (typeof arg1 === 'string') {
        opts.url = arg1;
        opts.name = name;
      } else if (arg1) {
        name = arg1.name;
        onload = arg1.onload;
        opts::pickIntoThis(arg1, [
          'url',
          'headers',
          'timeout',
          'onerror',
          'onprogress',
          'ontimeout',
        ]);
      }
      if (!name || typeof name !== 'string') {
        throw new ErrorSafe('Required parameter "name" is missing or not a string.');
      }
      assign(opts, {
        method: 'GET',
        responseType: 'blob',
        overrideMimeType: 'application/octet-stream',
        // Must be present and a function to trigger downloadBlob in content bridge
        onload: isFunction(onload) ? onload : (() => {}),
      });
      return onRequestCreate(opts, this, name);
    },
    GM_xmlhttpRequest(opts) {
      return onRequestCreate(opts, this);
    },
    /**
     * Bypasses site's CSP for inline `style`, `link`, and `script`.
     * @param {Node} [parent]
     * @param {string} tag
     * @param {Object} [attributes]
     * @returns {HTMLElement} it also has .then() so it should be compatible with TM
     */
    GM_addElement(parent, tag, attributes) {
      return typeof parent === 'string'
        ? webAddElement(null, parent, tag, this)
        : webAddElement(parent, tag, attributes, this);
    },
    /**
     * Bypasses site's CSP for inline `style`.
     * @param {string} css
     * @returns {HTMLElement} it also has .then() so it should be compatible with TM and old VM
     */
    GM_addStyle(css) {
      return webAddElement(null, 'style', { textContent: css, id: getUniqIdSafe('VMst') }, this);
    },
    GM_openInTab(url, options) {
      return onTabCreate(
        options && typeof options === 'object'
          ? assign(createNullObj(), options, { url })
          : { active: !options, url },
        this,
      );
    },
    GM_notification(text, title, image, onclick) {
      const options = typeof text === 'object' ? text : {
        __proto__: null,
        text,
        title,
        image,
        onclick,
      };
      if (!options.text) {
        throw new ErrorSafe('GM_notification: `text` is required!');
      }
      const id = onNotificationCreate(options, this);
      return {
        remove: vmOwnFunc(() => bridge.send('RemoveNotification', id, this)),
      };
    },
    GM_setClipboard(data, type) {
      bridge.post('SetClipboard', { data, type }, this);
    },
    // using the native console.log so the output has a clickable link to the caller's source
    GM_log: logging.log,
  };
}

function webAddElement(parent, tag, attrs, context) {
  let el;
  let errorInfo;
  bridge.syncCall('AddElement', { tag, attrs }, context, parent, function _(res) {
    el = this;
    errorInfo = res;
  }, 'cbId');
  // DOM error in content script can't be caught by a page-mode userscript so we rethrow it here
  if (errorInfo) {
    const err = new ErrorSafe(errorInfo[0]);
    err.stack += `\n${errorInfo[1]}`;
    throw err;
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
  const { id, resCache, resources } = context;
  const key = resources[name];
  if (key) {
    let res = resCache[key];
    if (!res) {
      bridge.syncCall('GetResource', { id, isBlob, key }, context, null, response => {
        res = response;
      });
      if (res !== true && isBlob) {
        res = createObjectURL(res);
      }
      resCache[key] = res;
    }
    return res === true ? key : res;
  }
}
