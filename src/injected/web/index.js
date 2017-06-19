import { getUniqId, bindEvents } from '../utils';
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
    bridge.load();
  }, false);
  bridge.checkLoad();
}

const commands = {};
const ainject = {};
const values = {};

const handlers = {
  LoadScripts: onLoadScripts,
  Command(data) {
    const func = commands[data];
    if (func) func();
  },
  GotRequestId: onRequestStart,
  HttpRequested: onRequestCallback,
  TabClosed: onTabClosed,
  UpdateValues(data) {
    if (values[data.uri]) values[data.uri] = data.values;
  },
  NotificationClicked: onNotificationClicked,
  NotificationClosed: onNotificationClosed,
  // advanced inject
  Injected(id) {
    const item = ainject[id];
    const func = window[`VM_${id}`];
    delete window[`VM_${id}`];
    delete ainject[id];
    if (item && func) runCode(item[0], func, item[1], item[2]);
  },
  ScriptChecked(data) {
    if (bridge.onScriptChecked) bridge.onScriptChecked(data);
  },
};

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
  ], location.host)) {
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
      values[script.uri] = data.values[script.uri] || {};
      if (script && script.enabled) {
        // XXX: use camelCase since v2.6.3
        const runAt = script.custom.runAt || script.custom['run-at']
          || script.meta.runAt || script.meta['run-at'];
        const list = listMap[runAt] || end;
        list.push(script);
      }
    });
    run(start);
  }
  bridge.checkLoad();
  function buildCode(script) {
    const requireKeys = script.meta.require || [];
    const wrapper = wrapGM(script, data.cache);
    // Must use Object.getOwnPropertyNames to list unenumerable properties
    const wrapperKeys = Object.getOwnPropertyNames(wrapper);
    const wrapperInit = map(wrapperKeys, name => `this["${name}"]=${name}`).join(';');
    const codeSlices = [`${wrapperInit};with(this)!function(){`];
    forEach(requireKeys, key => {
      const requireCode = data.require[key];
      if (requireCode) {
        codeSlices.push(requireCode);
        // Add `;` to a new line in case script ends with comment lines
        codeSlices.push(';');
      }
    });
    // wrap code to make 'use strict' work
    codeSlices.push(`!function(){${script.code}\n}.call(this)`);
    codeSlices.push('}.call(this);');
    const code = codeSlices.join('\n');
    const name = script.custom.name || script.meta.name || script.id;
    const args = map(wrapperKeys, key => wrapper[key]);
    const thisObj = wrapper.window || wrapper;
    const id = getUniqId();
    ainject[id] = [name, args, thisObj];
    bridge.post({ cmd: 'Inject', data: [id, wrapperKeys, code] });
  }
  function run(list) {
    while (list.length) buildCode(list.shift());
  }
}

function wrapGM(script, cache) {
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
  const gmFunctions = {
    unsafeWindow: { value: window },
    GM_info: {
      get() {
        const matches = script.code.match(/\/\/\s+==UserScript==\s+([\s\S]*?)\/\/\s+==\/UserScript==\s/);
        const obj = {
          scriptMetaStr: matches ? matches[1] : '',
          scriptWillUpdate: !!script.update,
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
        const value = getValues();
        delete value[key];
        saveValues();
      },
    },
    GM_getValue: {
      value(key, def) {
        const value = getValues();
        const raw = value[key];
        if (raw) {
          const type = raw[0];
          const handle = dataDecoders[type] || dataDecoders[''];
          let val = raw.slice(1);
          try {
            val = handle(val);
          } catch (e) {
            console.warn(e);
          }
          return val;
        }
        return def;
      },
    },
    GM_listValues: {
      value() {
        return Object.keys(getValues());
      },
    },
    GM_setValue: {
      value(key, val) {
        const type = (typeof val)[0];
        const handle = dataEncoders[type] || dataEncoders[''];
        const raw = type + handle(val);
        const value = getValues();
        value[key] = raw;
        saveValues();
      },
    },
    GM_getResourceText: {
      value(name) {
        if (name in resources) {
          const uri = resources[name];
          const raw = cache[uri];
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
            const raw = cache[key];
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
      value(data) {
        bridge.post({ cmd: 'AddStyle', data });
      },
    },
    GM_log: {
      value(data) {
        // eslint-disable-next-line no-console
        console.log(`[Violentmonkey][${script.meta.name || 'No name'}]`, data);
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
        commands[cap] = func;
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
  function getValues() {
    return values[script.uri];
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
  function saveValues() {
    bridge.post({
      cmd: 'SetValue',
      data: {
        uri: script.uri,
        values: getValues(),
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
