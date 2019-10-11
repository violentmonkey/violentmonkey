import { INJECT_PAGE, INJECT_CONTENT, METABLOCK_RE } from '#/common/consts';
import {
  getUniqId, bindEvents, attachFunction, cache2blobUrl,
} from '../utils';
import {
  includes, forEach, map, push, join, filter, Boolean, utf8decode, jsonDump, jsonLoad, atob,
  Promise, console, objectKeys, setTimeout, Error, defineProperty, defineProperties,
  match, slice, noop,
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

// Make sure to call safe::methods() in code that may run after userscripts

const { getElementById } = Document.prototype;
const { lastIndexOf, startsWith } = String.prototype;
const { concat } = Array.prototype;
const { Number } = global;

export default function initialize(
  webId,
  contentId,
  props,
  isFirefox,
  invokeHost,
) {
  let invokeGuest;
  bridge.props = props;
  if (invokeHost) {
    bridge.mode = INJECT_CONTENT;
    bridge.post = msg => invokeHost(msg, INJECT_CONTENT);
    invokeGuest = onHandle;
  } else {
    bridge.mode = INJECT_PAGE;
    bridge.post = bindEvents(webId, contentId, onHandle);
    bridge.post.asString = isFirefox;
  }
  document.addEventListener('DOMContentLoaded', () => {
    state = 1;
    // Load scripts after being handled by listeners in web page
    Promise.resolve().then(bridge.load);
  }, { once: true });
  return invokeGuest;
}

const store = {
  commands: {},
  values: {},
  callbacks: {},
};

const wrapperInfo = {
  [INJECT_CONTENT]: { unsafeWindow: global },
  [INJECT_PAGE]: { unsafeWindow: window },
  // store the initial eval now (before the page scripts run) just in case
  eval: {
    [INJECT_CONTENT]: global.eval, // eslint-disable-line no-eval
    [INJECT_PAGE]: window.eval, // eslint-disable-line no-eval
  },
};

let gmApi;

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
    objectKeys(updates)::forEach((id) => {
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
  if ([
    'greasyfork.org',
  ].includes(window.location.host)) {
    exposeVM();
  }
  // reset load and checkLoad
  bridge.load = () => {
    bridge.load = noop;
    run(end);
    setTimeout(runIdle);
  };
  const listMap = {
    'document-start': start,
    'document-idle': idle,
    'document-end': end,
  };
  if (data.scripts) {
    data.scripts.forEach((script) => {
      const runAt = script.custom.runAt || script.meta.runAt;
      const list = listMap[runAt] || end;
      list.push(script);
      store.values[script.props.id] = data.values[script.props.id];
    });
    run(start);
  }
  if (!state && ['interactive', 'complete'].includes(document.readyState)) {
    state = 1;
  }
  if (state) bridge.load();

  function buildCode(script) {
    const pathMap = script.custom.pathMap || {};
    const requireKeys = script.meta.require || [];
    const requires = requireKeys::map(key => data.require[pathMap[key] || key])::filter(Boolean);
    const code = data.code[script.props.id] || '';
    const { wrapper, thisObj, keys } = wrapGM(script, code, data.cache);
    const id = getUniqId('VMin');
    const fnId = getUniqId('VMfn');
    const codeSlices = [
      `function(${
        keys::join(',')
      }){${
        keys::map(name => `this["${name}"]=${name};`)::join('')
      }with(this)((define,module,exports)=>{`,
      // 1. trying to avoid string concatenation of potentially huge code slices
      // 2. adding `;` on a new line in case some required script ends with a line comment
      ...[]::concat(...requires::map(req => [req, '\n;'])),
      '(()=>{',
      code,
      // adding a new line in case the code ends with a line comment
      '\n})()})()}',
    ];
    const name = script.custom.name || script.meta.name || script.props.id;
    const args = keys::map(key => wrapper[key]);
    attachFunction(fnId, () => {
      const func = window[id];
      if (func) runCode(name, func, args, thisObj);
    });
    return [id, codeSlices, fnId, bridge.mode, script.props.id];
  }
  function run(list) {
    bridge.post({ cmd: 'InjectMulti', data: list::map(buildCode) });
    list.length = 0;
  }
  async function runIdle() {
    for (const script of idle) {
      bridge.post({ cmd: 'Inject', data: buildCode(script) });
      await new Promise(setTimeout);
    }
    // let GC sweep the no longer necessary stuff
    gmApi = null;
    idle.length = 0;
  }
}

function wrapGM(script, code, cache) {
  const { unsafeWindow } = wrapperInfo[bridge.mode];
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const gm = {};
  const grant = script.meta.grant || [];
  let thisObj = gm;
  if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
    // @grant none
    grant.length = 0;
    gm.window = unsafeWindow;
  } else {
    thisObj = getWrapper();
    gm.window = thisObj;
  }
  if (grant::includes('window.close')) {
    gm.window.close = () => {
      bridge.post({ cmd: 'TabClose' });
    };
  }
  const resources = script.meta.resources || {};
  const gmInfo = {
    uuid: script.props.uuid,
    scriptMetaStr: code::match(METABLOCK_RE)[1] || '',
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
      resources: objectKeys(resources)::map(name => ({
        name,
        url: resources[name],
      })),
      runAt: script.meta.runAt || '',
      unwrap: false, // deprecated, always `false`
      version: script.meta.version || '',
    },
  };
  const grantedProps = {
    unsafeWindow: propertyFromValue(unsafeWindow),
    GM_info: propertyFromValue(gmInfo),
  };
  let selfData;
  if (!gmApi) gmApi = createGmApiProps();
  grant::forEach((name) => {
    let prop = gmApi.boundProps[name];
    if (prop) {
      const gmFunction = prop.value;
      prop = { ...prop };
      prop.value = (...args) => gmFunction.apply(selfData, args);
      selfData = true;
    } else {
      prop = gmApi.props[name];
    }
    if (prop) grantedProps[name] = prop;
  });
  if (selfData) {
    selfData = {
      cache,
      script,
      resources,
      id: script.props.id,
      pathMap: script.custom.pathMap || {},
      urls: {},
    };
  }
  return {
    thisObj,
    wrapper: defineProperties(gm, grantedProps),
    keys: objectKeys(grantedProps),
  };
}

function createGmApiProps() {
  const dataDecoders = {
    o: val => jsonLoad(val),
    // deprecated
    n: val => Number(val),
    b: val => val === 'true',
  };

  // these are bound to script data that we pass via |this|

  const boundProps = {
    GM_deleteValue(key) {
      const value = loadValues(this);
      delete value[key];
      dumpValue(this, key);
    },
    GM_getValue(key, def) {
      const value = loadValues(this);
      const raw = value[key];
      if (raw) {
        const type = raw[0];
        const handle = dataDecoders[type];
        let val = raw::slice(1);
        try {
          if (handle) val = handle(val);
        } catch (e) {
          if (process.env.DEBUG) log('warn', 'GM_getValue', e);
        }
        return val;
      }
      return def;
    },
    GM_listValues() {
      return objectKeys(loadValues(this));
    },
    GM_setValue(key, val) {
      const dumped = jsonDump(val);
      const raw = dumped ? `o${dumped}` : null;
      const value = loadValues(this);
      value[key] = raw;
      dumpValue(this, key, raw);
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
    GM_log(...args) {
      let loglevel = 'log';
      if (args[0] === 'error'
        || args[0] === 'debug'
        || args[0] === 'info'
        || args[0] === 'log'
        || args[0] === 'warn') {
        loglevel = args.shift();
      }
      log(loglevel, [this.script.meta.name || 'No name'], ...args);
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
    GM_openInTab(url, options) {
      const data = options && typeof options === 'object' ? options : {
        active: !options,
      };
      data.url = url;
      return onTabCreate(data);
    },
    GM_xmlhttpRequest: onRequestCreate,
    GM_download: onDownload,
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
  return { props, boundProps };

  function loadValues({ id }) {
    return store.values[id];
  }
  function dumpValue({ id }, key, value) {
    bridge.post({
      cmd: 'UpdateValue',
      data: {
        id,
        update: { key, value },
      },
    });
  }
}

function propertyFromValue(value) {
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

function createWrapperMethods(info) {
  const { unsafeWindow } = info;
  const methods = {};
  [
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
  ]::forEach((name) => {
    const method = unsafeWindow[name];
    if (method) {
      methods[name] = (...args) => method.apply(unsafeWindow, args);
    }
  });
  info.methods = methods;
}

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function getWrapper() {
  const info = wrapperInfo[bridge.mode];
  const { unsafeWindow } = info;
  if (!info.methods) createWrapperMethods(info);
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  const wrapper = {
    // Block special objects
    browser: undefined,
    // `eval` should be called directly so that it is run in current scope
    eval: wrapperInfo.eval[bridge.mode],
    ...info.methods,
  };
  if (!info.propsToWrap) {
    info.propsToWrap = bridge.props::filter(p => !(p in wrapper));
    bridge.props = null;
  }
  function defineProtectedProperty(name) {
    let modified = false;
    let value;
    defineProperty(wrapper, name, {
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
    defineProperty(wrapper, name, {
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
  // A major GC may hit here no matter how we define props
  // all at once, in batches of 10, 100, 500, or one by one.
  // TODO: try Proxy API if userscripts wouldn't notice the difference
  info.propsToWrap::forEach((name) => {
    if (name::startsWith('on')) defineReactedProperty(name);
    else defineProtectedProperty(name);
  });
  return wrapper;
}

function log(level, tags, ...args) {
  const tagList = ['Violentmonkey'];
  if (tags) tagList::push(...tags);
  const prefix = tagList::map(tag => `[${tag}]`)::join('');
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
  defineProperty(Violentmonkey, 'getVersion', {
    value: () => Promise.resolve({
      version: bridge.version,
    }),
  });
  defineProperty(Violentmonkey, 'isInstalled', {
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
  defineProperty(window.external, 'Violentmonkey', {
    value: Violentmonkey,
  });
}
