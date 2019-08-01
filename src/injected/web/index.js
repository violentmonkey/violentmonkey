import { INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import {
  getUniqId, bindEvents, attachFunction, cache2blobUrl,
} from '../utils';
import {
  includes, forEach, map, push, utf8decode, jsonDump, jsonLoad,
  Promise, console,
} from '../utils/helpers';
import bridge from './bridge';
import { onRequestCreate, onRequestStart, onRequestCallback } from './requests';
import {
  onNotificationCreate,
  onNotificationClicked,
  onNotificationClosed,
} from './notifications';
import { onTabCreate, onTabClosed } from './tabs';
import { onDownload } from './download';

let state = 0;

export default function initialize(
  webId,
  contentId,
  props,
  mode = INJECT_PAGE,
) {
  bridge.props = props;
  bridge.mode = mode;
  bridge.post = bindEvents(webId, contentId, onHandle);
  document.addEventListener('DOMContentLoaded', () => {
    state = 1;
    // Load scripts after being handled by listeners in web page
    Promise.resolve().then(bridge.load);
  }, false);
  bridge.post({ cmd: 'Ready' });
}

const store = {
  commands: {},
  values: {},
  callbacks: {},
};

const handlers = {
  LoadScripts: onLoadScripts,
  Command(data) {
    const func = store.commands[data];
    if (func) func();
  },
  Callback({ callbackId, payload }) {
    const func = store.callbacks[callbackId];
    if (func) func(payload);
  },
  GotRequestId: onRequestStart,
  HttpRequested: onRequestCallback,
  TabClosed: onTabClosed,
  UpdatedValues(updates) {
    Object.keys(updates)
    .forEach((id) => {
      if (store.values[id]) store.values[id] = updates[id];
    });
  },
  NotificationClicked: onNotificationClicked,
  NotificationClosed: onNotificationClosed,
  ScriptChecked(data) {
    if (bridge.onScriptChecked) bridge.onScriptChecked(data);
  },
};

function registerCallback(callback) {
  const callbackId = getUniqId('VMcb');
  store.callbacks[callbackId] = (payload) => {
    callback(payload);
    delete store.callbacks[callbackId];
  };
  return callbackId;
}

function onHandle(obj) {
  const handle = handlers[obj.cmd];
  if (handle) handle(obj.data);
}

function onLoadScripts(data) {
  if (data.mode !== bridge.mode) return;
  const start = [];
  const idle = [];
  const end = [];
  bridge.version = data.version;
  if (includes([
    'greasyfork.org',
  ], window.location.host)) {
    exposeVM();
  }
  // reset load and checkLoad
  bridge.load = () => {
    run(end);
    setTimeout(run, 0, idle);
  };
  const listMap = {
    'document-start': start,
    'document-idle': idle,
    'document-end': end,
  };
  if (data.scripts) {
    forEach(data.scripts, (script) => {
      const runAt = script.custom.runAt || script.meta.runAt;
      const list = listMap[runAt] || end;
      push(list, script);
      store.values[script.props.id] = data.values[script.props.id];
    });
    run(start);
  }
  if (!state && includes(['interactive', 'complete'], document.readyState)) {
    state = 1;
  }
  if (state) bridge.load();

  function buildCode(script) {
    const requireKeys = script.meta.require || [];
    const pathMap = script.custom.pathMap || {};
    const code = data.code[script.props.id] || '';
    const unsafeWindow = bridge.mode === INJECT_CONTENT ? global : window;
    const { wrapper, thisObj, keys } = wrapGM(script, code, data.cache, unsafeWindow);
    const id = getUniqId('VMin');
    const fnId = getUniqId('VMfn');
    const wrapperInit = map(keys, name => `this["${name}"]=${name}`).join(';');
    const codeSlices = [
      `${wrapperInit};with(this)!function(define,module,exports){`,
    ];
    forEach(requireKeys, (key) => {
      const requireCode = data.require[pathMap[key] || key];
      if (requireCode) {
        push(
          codeSlices,
          requireCode,
          // Add `;` to a new line in case script ends with comment lines
          ';',
        );
      }
    });
    push(
      codeSlices,
      '!function(){',
      code,
      '}.call(this)}.call(this);',
    );
    const codeConcat = `function(${keys.join(',')}){${codeSlices.join('\n')}}`;
    const name = script.custom.name || script.meta.name || script.props.id;
    const args = map(keys, key => wrapper[key]);
    attachFunction(fnId, () => {
      const func = window[id];
      if (func) runCode(name, func, args, thisObj, codeConcat);
    });
    bridge.post({ cmd: 'Inject', data: [id, codeConcat, fnId, bridge.mode, script.props.id] });
  }
  function run(list) {
    while (list.length) buildCode(list.shift());
  }
}

function wrapGM(script, code, cache, unsafeWindow) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const gm = {};
  const grant = script.meta.grant || [];
  const urls = {};
  let thisObj = gm;
  if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
    // @grant none
    grant.pop();
    gm.window = unsafeWindow;
  } else {
    thisObj = getWrapper(unsafeWindow);
    gm.window = thisObj;
  }
  if (!includes(grant, 'unsafeWindow')) push(grant, 'unsafeWindow');
  if (!includes(grant, 'GM_info')) push(grant, 'GM_info');
  if (includes(grant, 'window.close')) gm.window.close = () => { bridge.post({ cmd: 'TabClose' }); };
  const resources = script.meta.resources || {};
  const dataDecoders = {
    o: val => jsonLoad(val),
    // deprecated
    n: val => Number(val),
    b: val => val === 'true',
  };
  const pathMap = script.custom.pathMap || {};
  const matches = code.match(/\/\/\s+==UserScript==\s+([\s\S]*?)\/\/\s+==\/UserScript==\s/);
  const metaStr = matches ? matches[1] : '';
  const gmInfo = {
    uuid: script.props.uuid,
    scriptMetaStr: metaStr,
    scriptWillUpdate: !!script.config.shouldUpdate,
    scriptHandler: 'Violentmonkey',
    version: bridge.version,
    injectInto: bridge.mode,
    script: {
      description: script.meta.description || '',
      excludes: [...script.meta.exclude],
      includes: [...script.meta.include],
      matches: [...script.meta.match],
      name: script.meta.name || '',
      namespace: script.meta.namespace || '',
      resources: Object.keys(resources).map(name => ({
        name,
        url: resources[name],
      })),
      runAt: script.meta.runAt || '',
      unwrap: false, // deprecated, always `false`
      version: script.meta.version || '',
    },
  };
  const gmFunctions = {
    unsafeWindow: { value: unsafeWindow },
    GM_info: { value: gmInfo },
    GM_deleteValue: {
      value(key) {
        const value = loadValues();
        delete value[key];
        dumpValue(key);
      },
    },
    GM_getValue: {
      value(key, def) {
        const value = loadValues();
        const raw = value[key];
        if (raw) {
          const type = raw[0];
          const handle = dataDecoders[type];
          let val = raw.slice(1);
          try {
            if (handle) val = handle(val);
          } catch (e) {
            if (process.env.DEBUG) log('warn', 'GM_getValue', e);
          }
          return val;
        }
        return def;
      },
    },
    GM_listValues: {
      value() {
        return Object.keys(loadValues());
      },
    },
    GM_setValue: {
      value(key, val) {
        const dumped = jsonDump(val);
        const raw = dumped ? `o${dumped}` : null;
        const value = loadValues();
        value[key] = raw;
        dumpValue(key, raw);
      },
    },
    GM_getResourceText: {
      value(name) {
        if (name in resources) {
          const key = resources[name];
          const raw = cache[pathMap[key] || key];
          const text = raw && utf8decode(window.atob(raw.split(',').pop()));
          return text;
        }
      },
    },
    GM_getResourceURL: {
      value(name) {
        if (name in resources) {
          const key = resources[name];
          let blobUrl = urls[key];
          if (!blobUrl) {
            const raw = cache[pathMap[key] || key];
            if (raw) {
              blobUrl = cache2blobUrl(raw);
              urls[key] = blobUrl;
            } else {
              blobUrl = key;
            }
          }
          return blobUrl;
        }
      },
    },
    GM_addStyle: {
      value(css) {
        const callbacks = [];
        let el = false;
        const callbackId = registerCallback((styleId) => {
          el = document.getElementById(styleId);
          callbacks.splice().forEach(callback => callback(el));
        });
        bridge.post({ cmd: 'AddStyle', data: { css, callbackId } });
        // Mock a Promise without the need for polyfill
        return {
          then(callback) {
            if (el !== false) callback(el);
            else push(callbacks, callback);
          },
        };
      },
    },
    GM_log: {
      value(...args) {
        log('log', [script.meta.name || 'No name'], ...args);
      },
    },
    GM_openInTab: {
      value(url, options) {
        const data = options && typeof options === 'object' ? options : {
          active: !options,
        };
        data.url = url;
        return onTabCreate(data);
      },
    },
    GM_registerMenuCommand: {
      value(cap, func) {
        const { id } = script.props;
        const key = `${id}:${cap}`;
        store.commands[key] = func;
        bridge.post({ cmd: 'RegisterMenu', data: [id, cap] });
      },
    },
    GM_unregisterMenuCommand: {
      value(cap) {
        const { id } = script.props;
        const key = `${id}:${cap}`;
        delete store.commands[key];
        bridge.post({ cmd: 'UnregisterMenu', data: [id, cap] });
      },
    },
    GM_xmlhttpRequest: {
      value: onRequestCreate,
    },
    GM_download: {
      value: onDownload,
    },
    GM_notification: {
      value(text, title, image, onclick) {
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
    },
    GM_setClipboard: {
      value(data, type) {
        bridge.post({
          cmd: 'SetClipboard',
          data: { type, data },
        });
      },
    },
  };
  const keys = [];
  forEach(grant, (name) => {
    const prop = gmFunctions[name];
    if (prop) {
      push(keys, name);
      addProperty(name, prop, gm);
    }
  });
  return { thisObj, wrapper: gm, keys };
  function loadValues() {
    return store.values[script.props.id];
  }
  function propertyToString() {
    return '[Violentmonkey property]';
  }
  function addProperty(name, prop, obj) {
    if ('value' in prop) prop.writable = false;
    prop.configurable = false;
    Object.defineProperty(obj, name, prop);
    if (typeof obj[name] === 'function') obj[name].toString = propertyToString;
  }
  function dumpValue(key, value) {
    bridge.post({
      cmd: 'UpdateValue',
      data: {
        id: script.props.id,
        update: { key, value },
      },
    });
  }
}

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function getWrapper(unsafeWindow) {
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  const wrapper = {};
  // Block special objects
  forEach([
    'browser',
  ], (name) => {
    wrapper[name] = undefined;
  });
  forEach([
    // `eval` should be called directly so that it is run in current scope
    'eval',
  ], (name) => {
    wrapper[name] = unsafeWindow[name];
  });
  forEach([
    // 'uneval',
    'isFinite',
    'isNaN',
    'parseFloat',
    'parseInt',
    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',

    'addEventListener',
    'alert',
    'atob',
    'blur',
    'btoa',
    'clearInterval',
    'clearTimeout',
    'close',
    'confirm',
    'dispatchEvent',
    'fetch',
    'find',
    'focus',
    'getComputedStyle',
    'getDefaultComputedStyle', // Non-standard, Firefox only, used by jQuery
    'getSelection',
    'matchMedia',
    'moveBy',
    'moveTo',
    'open',
    'openDialog',
    'postMessage',
    'print',
    'prompt',
    'removeEventListener',
    'requestAnimationFrame',
    'resizeBy',
    'resizeTo',
    'scroll',
    'scrollBy',
    'scrollByLines',
    'scrollByPages',
    'scrollTo',
    'setInterval',
    'setTimeout',
    'stop',
  ], (name) => {
    const method = unsafeWindow[name];
    if (method) {
      wrapper[name] = (...args) => method.apply(unsafeWindow, args);
    }
  });
  function defineProtectedProperty(name) {
    let modified = false;
    let value;
    Object.defineProperty(wrapper, name, {
      get() {
        if (!modified) value = unsafeWindow[name];
        return value === unsafeWindow ? wrapper : value;
      },
      set(val) {
        modified = true;
        value = val;
      },
    });
  }
  function defineReactedProperty(name) {
    Object.defineProperty(wrapper, name, {
      get() {
        const value = unsafeWindow[name];
        return value === unsafeWindow ? wrapper : value;
      },
      set(val) {
        unsafeWindow[name] = val;
      },
    });
  }
  // Wrap properties
  forEach(bridge.props, (name) => {
    if (name in wrapper) return;
    if (name.slice(0, 2) === 'on') defineReactedProperty(name);
    else defineProtectedProperty(name);
  });
  return wrapper;
}

function log(level, tags, ...args) {
  const tagList = ['Violentmonkey'];
  if (tags) push(tagList, ...tags);
  const prefix = tagList.map(tag => `[${tag}]`).join('');
  console[level](prefix, ...args);
}

function runCode(name, func, args, thisObj) {
  if (process.env.DEBUG) {
    log('info', [bridge.mode], name);
  }
  func.apply(thisObj, args);
}

function exposeVM() {
  const Violentmonkey = {};
  const checking = {};
  let key = 0;
  bridge.onScriptChecked = ({ callback, result }) => {
    const cb = checking[callback];
    if (cb) {
      cb(result);
      delete checking[callback];
    }
  };
  Object.defineProperty(Violentmonkey, 'getVersion', {
    value: () => Promise.resolve({
      version: bridge.version,
    }),
  });
  Object.defineProperty(Violentmonkey, 'isInstalled', {
    value: (name, namespace) => new Promise((resolve) => {
      key += 1;
      const callback = key;
      checking[callback] = resolve;
      bridge.post({
        cmd: 'CheckScript',
        data: {
          name,
          namespace,
          callback,
        },
      });
    }),
  });
  Object.defineProperty(window.external, 'Violentmonkey', {
    value: Violentmonkey,
  });
}
