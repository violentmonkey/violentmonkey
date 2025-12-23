import { isEmpty } from '../util';
import bridge from './bridge';
import { commands, storages } from './store';
import { onTabCreate } from './tabs';
import { onRequestCreate, onRequestInitError } from './requests';
import { createNotification } from './notifications';
import { changeHooks, decodeValue, dumpValue } from './gm-values';

const resolveOrReturn = (context, val) => (
  context.async ? promiseResolve(val) : val
);

/** Name in Greasemonkey4 -> name in GM, all methods are context-bound */
export const GM4_ALIAS = createNullObj();
/** Context-bound + async when used as GM.xxx */
export const GM_API_CTX_GM4ASYNC = {
  __proto__: null,
  /** @this {GMContext} */
  GM_deleteValue(key) {
    return dumpValue(this, false, [key]);
  },
  /** @this {GMContext} */
  GM_deleteValues(keys) {
    return dumpValue(this, false, keys);
  },
  /** @this {GMContext} */
  GM_getValue(key, def) {
    const raw = storages[this.id][key];
    return resolveOrReturn(this, raw ? decodeValue(raw) : def);
  },
  /** @this {GMContext} */
  GM_getValues(what) {
    const res = {};
    const isArr = arrayIsArray(what);
    const values = storages[this.id];
    for (const key of isArr ? what : objectKeys(what)) {
      const raw = values[key];
      if (raw) setOwnProp(res, key, decodeValue(raw));
      else if (!isArr) setOwnProp(res, key, what[key]);
    }
    return resolveOrReturn(this, res);
  },
  /** @this {GMContext} */
  GM_listValues() {
    return resolveOrReturn(this, objectKeys(storages[this.id]));
  },
  /** @this {GMContext} */
  GM_setValue(key, val) {
    return dumpValue(this, true, { [key]: val });
  },
  /** @this {GMContext} */
  GM_setValues(obj) {
    return dumpValue(this, true, obj);
  },
  /**
   * @this {GMContext}
   * @param {VMScriptGMDownloadOptions|string} opts
   * @param {string} [name]
   */
  GM_download(opts, name) {
    if (isString(opts)) {
      opts = { url: opts, name, __proto__: null };
    } else if (opts) {
      opts = nullObjFrom(opts);
      name = opts.name;
    }
    if (!name ? (name = 'missing') : !isString(name) && (name = 'not a string')) {
      onRequestInitError(opts, new SafeError(`Required parameter "name" is ${name}.`));
      return;
    }
    assign(opts, {
      [kResponseType]: 'blob',
      data: null,
      method: 'GET',
      overrideMimeType: 'application/octet-stream',
    });
    return onRequestCreate(opts, this, name);
  },
};

/** Context-bound. Methods mirrored to GM4_ALIAS are async when used as GM.xxx */
export const GM_API_CTX = {
  __proto__: null,
  /**
   * @callback GMValueChangeListener
   * @param {String} key
   * @param {?} oldValue - `undefined` means value was created
   * @param {?} newValue - `undefined` means value was removed
   * @param {boolean} remote - `true` means value was modified in another tab
   */
  /**
   * @this {GMContext}
   * @param {String} key - name of the value to monitor
   * @param {GMValueChangeListener} fn - callback
   * @returns {String} listenerId
   */
  GM_addValueChangeListener(key, fn) {
    if (!isString(key)) key = `${key}`;
    if (!isFunction(fn)) return;
    const hooks = ensureNestedProp(changeHooks, this.id, key);
    const i = objectValues(hooks)::indexOf(fn);
    let listenerId = i >= 0 && objectKeys(hooks)[i];
    if (!listenerId) {
      listenerId = safeGetUniqId('VMvc');
      hooks[listenerId] = fn;
    }
    return listenerId;
  },
  /**
   * @this {GMContext}
   * @param {String} listenerId
   */
  GM_removeValueChangeListener(listenerId) {
    const keyHooks = changeHooks[this.id];
    if (!keyHooks) return;
    if (process.env.DEBUG) throwIfProtoPresent(keyHooks);
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
  /** @this {GMContext} */
  GM_getResourceText(name) {
    return getResource(this, name);
  },
  GM_getResourceURL: GM4_ALIAS.getResourceUrl = function (name, isBlobUrl) {
    return getResource(this, name, !!isBlobUrl, isBlobUrl === undefined);
  },
  /** @this {GMContext} */
  GM_registerMenuCommand(text, cb, opts) {
    opts = nullObjFrom(opts);
    opts.text = text = `${text}`;
    if (!text) throw new SafeError('Menu caption text is required!');
    const { id } = this;
    const key = opts.id || text;
    const cmd = ensureNestedProp(commands, id, key);
    cmd.cb = cb;
    cmd.text = text;
    bridge.post('RegisterMenu', { id, key, val: opts });
    return key;
  },
  /** @this {GMContext} */
  GM_unregisterMenuCommand(key) {
    const { id } = this;
    const hub = commands[id];
    if (hub && (hub[key] || (key = findCommandIdByText(key, hub)))) {
      delete hub[key];
      bridge.post('UnregisterMenu', { id, key });
    }
  },
  GM_notification: createNotification,
  GM_xmlhttpRequest: GM4_ALIAS.xmlHttpRequest = function (opts) {
    return onRequestCreate(nullObjFrom(opts), this);
  },
};

/** Not bound to script context */
export const GM_API = {
  __proto__: null,
  /**
   * Bypasses site's CSP for inline `style`, `link`, and `script`.
   * @param {Node} [parent]
   * @param {string} tag
   * @param {Object} [attributes]
   * @returns {HTMLElement} it also has .then() so it should be compatible with TM
   */
  GM_addElement(parent, tag, attributes) {
    return isString(parent)
      ? webAddElement(null, parent, tag)
      : webAddElement(parent, tag, attributes);
  },
  /**
   * Bypasses site's CSP for inline `style`.
   * @param {string} css
   * @returns {HTMLElement} it also has .then() so it should be compatible with TM and old VM
   */
  GM_addStyle(css) {
    return webAddElement(null, 'style', { textContent: css, id: safeGetUniqId('VMst') });
  },
  GM_openInTab(url, options) {
    options = nullObjFrom(isObject(options) ? options : { active: !options });
    options.url = url;
    return onTabCreate(options);
  },
  GM_setClipboard(data, type) {
    bridge.post('SetClipboard', { data, type });
  },
  // using the native console.log so the output has a clickable link to the caller's source
  GM_log: logging.log,
};

function webAddElement(parent, tag, attrs) {
  let el;
  let errorInfo;
  bridge.call('AddElement', { tag, attrs }, parent, function _(res) {
    el = this;
    errorInfo = res;
  }, 'cbId');
  // DOM error in content script can't be caught by a page-mode userscript so we rethrow it here
  if (errorInfo) {
    const err = new SafeError(errorInfo[0]);
    err.stack += `\n${errorInfo[1]}`;
    throw err;
  }
  /* A Promise polyfill is not actually necessary because DOM messaging is synchronous,
     but we keep it for compatibility with GM_addStyle in VM of 2017-2019
     https://github.com/violentmonkey/violentmonkey/issues/217
     as well as for GM_addElement in Tampermonkey. */
  return setOwnProp(el, 'then', async cb => (
    // Preventing infinite resolve loop
    delete el.then
    // Native Promise ignores non-function
    && (isFunction(cb) ? cb(el) : el)
  ));
}

/**
 * @param {GMContext} context
 * @param name
 * @param isBlob
 * @param isBlobAuto
 */
function getResource(context, name, isBlob, isBlobAuto) {
  let res;
  const { id, resCache, resources } = context;
  const key = resources[name];
  if (key) {
    // data URIs aren't cached in bridge, so we'll send them
    const isData = key::slice(0, 5) === 'data:';
    const bucketKey = isBlob == null ? 0 : 1 + (isBlob = isBlobAuto ? !isData : isBlob);
    res = isData && isBlob === false || ensureNestedProp(resCache, bucketKey, key, false);
    if (!res) {
      res = bridge.call('GetResource', { id, isBlob, key, raw: isData && key });
      ensureNestedProp(resCache, bucketKey, key, res);
    }
  }
  return resolveOrReturn(context, res === true ? key : res);
}

function findCommandIdByText(text, hub) {
  for (const id in hub) {
    if (hub[id].text === text) {
      return id;
    }
  }
}
