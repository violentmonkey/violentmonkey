/**
 * All functions to be injected into web page must be independent.
 * They must be assigned to `bridge` so that they can be serialized.
 */
import base from './bridge';

export default Object.assign({
  utf8decode,
  getRequest,
  getTab,
  wrapGM,
  getWrapper,
  onLoadScripts,
  runCode,
  initialize,
  state: 0,
  handle: handleWeb,
}, base);

/**
 * http://www.webtoolkit.info/javascript-utf8.html
 */
function utf8decode(utftext) {
  /* eslint-disable no-bitwise */
  let string = '';
  let i = 0;
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  while (i < utftext.length) {
    c1 = utftext.charCodeAt(i);
    if (c1 < 128) {
      string += String.fromCharCode(c1);
      i += 1;
    } else if (c1 > 191 && c1 < 224) {
      c2 = utftext.charCodeAt(i + 1);
      string += String.fromCharCode(((c1 & 31) << 6) | (c2 & 63));
      i += 2;
    } else {
      c2 = utftext.charCodeAt(i + 1);
      c3 = utftext.charCodeAt(i + 2);
      string += String.fromCharCode(((c1 & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      i += 3;
    }
  }
  return string;
  /* eslint-enable no-bitwise */
}

function onLoadScripts(data) {
  const bridge = this;
  const start = [];
  const idle = [];
  const end = [];
  bridge.command = {};
  bridge.notif = {};
  bridge.ainject = {};
  bridge.version = data.version;
  bridge.values = {};
  // reset load and checkLoad
  bridge.load = () => {
    run(end);
    setTimeout(run, 0, idle);
  };
  bridge.checkLoad = () => {
    if (!bridge.state && bridge.includes(['interactive', 'complete'], document.readyState)) bridge.state = 1;
    if (bridge.state) bridge.load();
  };
  const listMap = {
    'document-start': start,
    'document-idle': idle,
    'document-end': end,
  };
  bridge.forEach(data.scripts, script => {
    bridge.values[script.uri] = data.values[script.uri] || {};
    if (script && script.enabled) {
      const list = listMap[
        script.custom.runAt || script.custom['run-at']
        || script.meta.runAt || script.meta['run-at']
      ] || end;
      list.push(script);
    }
  });
  run(start);
  bridge.checkLoad();
  function buildCode(script) {
    const requireKeys = script.meta.require || [];
    const wrapper = bridge.wrapGM(script, data.cache);
    // Must use Object.getOwnPropertyNames to list unenumerable properties
    const wrapperKeys = Object.getOwnPropertyNames(wrapper);
    const wrapperInit = bridge.map(wrapperKeys, name => `this["${name}"]=${name}`).join(';');
    const codeSlices = [`${wrapperInit};with(this)!function(){`];
    bridge.forEach(requireKeys, key => {
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
    const args = bridge.map(wrapperKeys, key => wrapper[key]);
    const thisObj = wrapper.window || wrapper;
    const id = bridge.getUniqId();
    bridge.ainject[id] = [name, args, thisObj];
    bridge.post({ cmd: 'Inject', data: [id, wrapperKeys, code] });
  }
  function run(list) {
    while (list.length) buildCode(list.shift());
  }
}

function handleWeb(obj) {
  const bridge = this;
  const handlers = {
    LoadScripts(data) {
      bridge.onLoadScripts(data);
    },
    Command(data) {
      const func = bridge.command[data];
      if (func) func();
    },
    GotRequestId(id) {
      const req = bridge.requests.queue.shift();
      req.start(req, id);
    },
    HttpRequested(res) {
      const req = bridge.requests.map[res.id];
      if (req) req.callback(req, res);
    },
    TabClosed(key) {
      const item = bridge.tabs[key];
      if (item) {
        item.closed = true;
        const { onclose } = item;
        if (onclose) onclose();
        delete bridge.tabs[key];
      }
    },
    UpdateValues(data) {
      const { values } = bridge;
      if (values && values[data.uri]) values[data.uri] = data.values;
    },
    NotificationClicked(id) {
      const options = bridge.notif[id];
      if (options) {
        const { onclick } = options;
        if (onclick) onclick();
      }
    },
    NotificationClosed(id) {
      const options = bridge.notif[id];
      if (options) {
        delete bridge.notif[id];
        const { ondone } = options;
        if (ondone) ondone();
      }
    },
    // advanced inject
    Injected(id) {
      const item = bridge.ainject[id];
      const func = window[`VM_${id}`];
      delete window[`VM_${id}`];
      delete bridge.ainject[id];
      if (item && func) bridge.runCode(item[0], func, item[1], item[2]);
    },
  };
  const handle = handlers[obj.cmd];
  if (handle) handle(obj.data);
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

function getRequest(arg) {
  const bridge = this;
  init();
  return bridge.getRequest(arg);
  function init() {
    bridge.requests = {
      map: {},
      queue: [],
    };
    bridge.getRequest = details => {
      const req = {
        details,
        callback,
        start,
        req: {
          abort: reqAbort,
        },
      };
      details.url = getFullUrl(details.url);
      bridge.requests.queue.push(req);
      bridge.post({ cmd: 'GetRequestId' });
      return req.req;
    };
  }
  function reqAbort() {
    bridge.post({ cmd: 'AbortRequest', data: this.id });
  }
  function parseData(req, details) {
    if (req.resType) {
      // blob or arraybuffer
      let data = req.data.response.split(',');
      const mimetype = data[0].match(/^data:(.*?);base64$/);
      if (!mimetype) {
        // invalid
        req.data.response = null;
      } else {
        data = window.atob(data[1]);
        const arr = new window.Uint8Array(data.length);
        for (let i = 0; i < data.length; i += 1) arr[i] = data.charCodeAt(i);
        if (details.responseType === 'blob') {
          // blob
          return new Blob([arr], { type: mimetype });
        }
        // arraybuffer
        return arr.buffer;
      }
    } else if (details.responseType === 'json') {
      // json
      return JSON.parse(req.data.response);
    } else {
      // text
      return req.data.response;
    }
  }
  // request object functions
  function callback(req, res) {
    const cb = req.details[`on${res.type}`];
    if (cb) {
      if (res.data.response) {
        if (!req.data) req.data = [parseData(res, req.details)];
        res.data.response = req.data[0];
      }
      res.data.context = req.details.context;
      cb(res.data);
    }
    if (res.type === 'loadend') delete bridge.requests.map[req.id];
  }
  function start(req, id) {
    const { details } = req;
    const data = {
      id,
      method: details.method,
      url: details.url,
      data: details.data,
      // async: !details.synchronous,
      user: details.user,
      password: details.password,
      headers: details.headers,
      overrideMimeType: details.overrideMimeType,
    };
    req.id = id;
    bridge.requests.map[id] = req;
    if (bridge.includes(['arraybuffer', 'blob'], details.responseType)) {
      data.responseType = 'blob';
    }
    bridge.post({ cmd: 'HttpRequest', data });
  }
  function getFullUrl(url) {
    const a = document.createElement('a');
    a.setAttribute('href', url);
    return a.href;
  }
}

function getTab(detail) {
  const bridge = this;
  init();
  return bridge.getTab(detail);
  function init() {
    bridge.tabs = {};
    bridge.getTab = data => {
      const key = bridge.getUniqId();
      const item = {
        close() {
          bridge.post({ cmd: 'TabClose', data: key });
        },
        onclose: null,
        closed: false,
      };
      bridge.tabs[key] = item;
      bridge.post({ cmd: 'TabOpen', data: { key, data } });
      return item;
    };
  }
}

function wrapGM(script, cache) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const bridge = this;
  const gm = {};
  const grant = script.meta.grant || [];
  const urls = {};
  if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
    // @grant none
    grant.pop();
  } else {
    gm.window = bridge.getWrapper();
  }
  if (!bridge.includes(grant, 'unsafeWindow')) grant.push('unsafeWindow');
  if (!bridge.includes(grant, 'GM_info')) grant.push('GM_info');
  if (bridge.includes(grant, 'window.close')) gm.window.close = () => { bridge.post({ cmd: 'TabClose' }); };
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
            unwrap: false,  // deprecated, always `false`
            version: script.meta.version || '',
          },
        };
        return obj;
      },
    },
    GM_deleteValue: {
      value(key) {
        const values = getValues();
        delete values[key];
        saveValues();
      },
    },
    GM_getValue: {
      value(key, def) {
        const values = getValues();
        const raw = values[key];
        if (raw) {
          const type = raw[0];
          const handle = dataDecoders[type] || dataDecoders[''];
          let value = raw.slice(1);
          try {
            value = handle(value);
          } catch (e) {
            console.warn(e);
          }
          return value;
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
        let value = val;
        value = type + handle(value);
        const values = getValues();
        values[key] = value;
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
        console.log(`[Violentmonkey][${script.meta.name || 'No name'}]`, data);  // eslint-disable-line no-console
      },
    },
    GM_openInTab: {
      value(url, options = { active: false }) {
        const data = options && typeof options === 'object' ? options : {
          active: !options,
        };
        data.url = url;
        return bridge.getTab(data);
      },
    },
    GM_registerMenuCommand: {
      value(cap, func, acc) {
        bridge.command[cap] = func;
        bridge.post({ cmd: 'RegisterMenu', data: [cap, acc] });
      },
    },
    GM_xmlhttpRequest: {
      value(details) {
        return bridge.getRequest(details);
      },
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
        const id = (bridge.notif[''] || 0) + 1;
        bridge.notif[''] = id;
        bridge.notif[id] = options;
        bridge.post({
          cmd: 'Notification',
          data: {
            id,
            text: options.text,
            title: options.title,
            image: options.image,
          },
        });
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
  bridge.forEach(grant, name => {
    const prop = gmFunctions[name];
    if (prop) addProperty(name, prop, gm);
  });
  return gm;
  function getValues() {
    return bridge.values[script.uri];
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
 * @desc Wrap methods to prevent unexpected modifications.
 */
function getWrapper() {
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  const bridge = this;
  const wrapper = {};
  bridge.forEach([
    // `eval` should be called directly so that it is run in current scope
    'eval',
  ], name => {
    wrapper[name] = window[name];
  });
  bridge.forEach([
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
  bridge.forEach(bridge.props, name => {
    if (name in wrapper) return;
    if (name.slice(0, 2) === 'on') defineReactedProperty(name);
    else defineProtectedProperty(name);
  });
  return wrapper;
}

function initialize(src, dest, props) {
  const bridge = this;
  bridge.props = props;
  bridge.load = bridge.noop;
  bridge.checkLoad = bridge.noop;
  bridge.bindEvents(src, dest);
}
