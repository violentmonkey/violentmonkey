import { getUniqId, bindEvents, Promise, attachFunction, console } from '../utils';
import { includes, forEach, map, utf8decode } from './helpers';
import bridge from './bridge';
import { onRequestCreate, onRequestStart, onRequestCallback } from './requests';
import {
  onNotificationCreate,
  onNotificationClicked,
  onNotificationClosed,
} from './notifications';
import { onTabCreate, onTabClosed } from './tabs';

let state = 0;

export default function initialize(webId, contentId, props) {
  bridge.props = props;
  bridge.post = bindEvents(webId, contentId, onHandle);
  document.addEventListener('DOMContentLoaded', () => {
    state = 1;
    // Load scripts after being handled by listeners in web page
    Promise.resolve().then(bridge.load);
  }, false);
  bridge.checkLoad();
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
    .forEach(id => {
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
  store.callbacks[callbackId] = payload => {
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
  bridge.checkLoad = () => {
    if (!state && includes(['interactive', 'complete'], document.readyState)) {
      state = 1;
    }
    if (state) bridge.load();
  };
  const listMap = {
    'document-start': start,
    'document-idle': idle,
    'document-end': end,
  };
  if (data.scripts) {
    forEach(data.scripts, script => {
      if (script && script.config.enabled) {
        // XXX: use camelCase since v2.6.3
        const runAt = script.custom.runAt || script.custom['run-at']
          || script.meta.runAt || script.meta['run-at'];
        const list = listMap[runAt] || end;
        list.push(script);
        store.values[script.props.id] = data.values[script.props.id];
      }
    });
    run(start);
  }
  bridge.checkLoad();
  function buildCode(script) {
    const requireKeys = script.meta.require || [];
    const pathMap = script.custom.pathMap || {};
    const code = data.code[script.props.id] || '';
    const wrapper = wrapGM(script, code, data.cache);
    // Must use Object.getOwnPropertyNames to list unenumerable properties
    const argNames = Object.getOwnPropertyNames(wrapper);
    const wrapperInit = map(argNames, name => `this["${name}"]=${name}`).join(';');
    const codeSlices = [`${wrapperInit};with(this)!function(){`];
    forEach(requireKeys, key => {
      const requireCode = data.require[pathMap[key] || key];
      if (requireCode) {
        codeSlices.push(requireCode);
        // Add `;` to a new line in case script ends with comment lines
        codeSlices.push(';');
      }
    });
    // wrap code to make 'use strict' work
    codeSlices.push(`!function(){${code}\n}.call(this)`);
    codeSlices.push('}.call(this);');
    const codeConcat = codeSlices.join('\n');
    const name = script.custom.name || script.meta.name || script.props.id;
    const args = map(argNames, key => wrapper[key]);
    const thisObj = wrapper.window || wrapper;
    const id = getUniqId('VMin');
    const fnId = getUniqId('VMfn');
    attachFunction(fnId, () => {
      const func = window[id];
      if (func) runCode(name, func, args, thisObj);
    });
    bridge.post({ cmd: 'Inject', data: [id, argNames, codeConcat, fnId] });
  }
  function run(list) {
    while (list.length) buildCode(list.shift());
  }
}

function wrapGM(script, code, cache) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const gm = {};
  const grant = script.meta.grant || [];
  const urls = {};
  if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
    // @grant none
    grant.pop();
  } else {
    gm.window = getWrapper();
  }
  if (!includes(grant, 'unsafeWindow')) grant.push('unsafeWindow');
  if (!includes(grant, 'GM_info')) grant.push('GM_info');
  if (includes(grant, 'window.close')) gm.window.close = () => { bridge.post({ cmd: 'TabClose' }); };
  const resources = script.meta.resources || {};
  const dataEncoders = {
    o: val => JSON.stringify(val),
    '': val => val.toString(),
  };
  const dataDecoders = {
    n: val => Number(val),
    b: val => val === 'true',
    o: val => JSON.parse(val),
    '': val => val,
  };
  const pathMap = script.custom.pathMap || {};
  const matches = code.match(/\/\/\s+==UserScript==\s+([\s\S]*?)\/\/\s+==\/UserScript==\s/);
  const metaStr = matches ? matches[1] : '';
  const gmFunctions = {
    unsafeWindow: { value: window },
    GM_info: {
      get() {
        const obj = {
          scriptMetaStr: metaStr,
          scriptWillUpdate: !!script.config.shouldUpdate,
          scriptHandler: 'Violentmonkey',
          version: bridge.version,
          script: {
            description: script.meta.description || '',
            excludes: script.meta.exclude.concat(),
            includes: script.meta.include.concat(),
            matches: script.meta.match.concat(),
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
        return obj;
      },
    },
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
          const handle = dataDecoders[type] || dataDecoders[''];
          let val = raw.slice(1);
          try {
            val = handle(val);
          } catch (e) {
            if (process.env.DEBUG) console.warn(e);
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
        const type = (typeof val)[0];
        const handle = dataEncoders[type] || dataEncoders[''];
        const raw = type + handle(val);
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
          const text = raw && utf8decode(window.atob(raw));
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
              // Binary string is not supported by blob constructor,
              // so we have to transform it into array buffer.
              const bin = window.atob(raw);
              const arr = new window.Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
              const blob = new Blob([arr]);
              blobUrl = URL.createObjectURL(blob);
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
        const callbackId = registerCallback(styleId => {
          el = document.getElementById(styleId);
          callbacks.splice().forEach(callback => callback(el));
        });
        bridge.post({ cmd: 'AddStyle', data: { css, callbackId } });
        // Mock a Promise without the need for polyfill
        return {
          then(callback) {
            if (el !== false) callback(el);
            else callbacks.push(callback);
          },
        };
      },
    },
    GM_log: {
      value(...args) {
        // eslint-disable-next-line no-console
        console.log(`[Violentmonkey][${script.meta.name || 'No name'}]`, ...args);
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
      value(cap, func, acc) {
        store.commands[cap] = func;
        bridge.post({ cmd: 'RegisterMenu', data: [cap, acc] });
      },
    },
    GM_xmlhttpRequest: {
      value: onRequestCreate,
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
  forEach(grant, name => {
    const prop = gmFunctions[name];
    if (prop) addProperty(name, prop, gm);
  });
  return gm;
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
function getWrapper() {
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  const wrapper = {};
  forEach([
    // `eval` should be called directly so that it is run in current scope
    'eval',
  ], name => {
    wrapper[name] = window[name];
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
  ], name => {
    const method = window[name];
    if (method) {
      wrapper[name] = (...args) => method.apply(window, args);
    }
  });
  function defineProtectedProperty(name) {
    let modified = false;
    let value;
    Object.defineProperty(wrapper, name, {
      get() {
        if (!modified) value = window[name];
        return value === window ? wrapper : value;
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
        const value = window[name];
        return value === window ? wrapper : value;
      },
      set(val) {
        window[name] = val;
      },
    });
  }
  // Wrap properties
  forEach(bridge.props, name => {
    if (name in wrapper) return;
    if (name.slice(0, 2) === 'on') defineReactedProperty(name);
    else defineProtectedProperty(name);
  });
  return wrapper;
}

function runCode(name, func, args, thisObj) {
  if (process.env.DEBUG) {
    console.log(`Run script: ${name}`); // eslint-disable-line no-console
  }
  try {
    func.apply(thisObj, args);
  } catch (e) {
    let msg = `Error running script: ${name}\n${e}`;
    if (e.message) msg = `${msg}\n${e.message}`;
    console.error(msg);
  }
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
    value: (name, namespace) => new Promise(resolve => {
      key += 1;
      const callback = checking[key];
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
