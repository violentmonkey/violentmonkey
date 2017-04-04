(function injectContent() {
  // Avoid running repeatedly due to new `document.documentElement`
  if (window.VM) return;
  window.VM = 1;

  function getUniqId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

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

  function sendMessage(data) {
    return browser.runtime.sendMessage(data);
  }

  const badge = {
    number: 0,
    ready: false,
    willSet: false,
  };
  function getBadge() {
    badge.willSet = true;
    setBadge();
  }
  function setBadge() {
    if (badge.ready && badge.willSet) {
      // XXX: only scripts run in top level window are counted
      if (top === window) sendMessage({ cmd: 'SetBadge', data: badge.number });
    }
  }
  function handleWeb(obj) {
    const comm = this;
    const handlers = {
      LoadScripts(data) {
        comm.onLoadScripts(data);
      },
      Command(data) {
        const func = comm.command[data];
        if (func) func();
      },
      GotRequestId(id) {
        const req = comm.qrequests.shift();
        req.start(req, id);
      },
      HttpRequested(res) {
        const req = comm.requests[res.id];
        if (req) req.callback(req, res);
      },
      UpdateValues(data) {
        const { values } = comm.values;
        if (values && values[data.uri]) values[data.uri] = data.values;
      },
      NotificationClicked(id) {
        const options = comm.notif[id];
        if (options) {
          const { onclick } = options;
          if (onclick) onclick();
        }
      },
      NotificationClosed(id) {
        const options = comm.notif[id];
        if (options) {
          delete comm.notif[id];
          const { ondone } = options;
          if (ondone) ondone();
        }
      },
      // advanced inject
      Injected(id) {
        const item = comm.ainject[id];
        const func = window[`VM_${id}`];
        delete window[`VM_${id}`];
        delete comm.ainject[id];
        if (item && func) comm.runCode(item[0], func, item[1], item[2]);
      },
    };
    const handle = handlers[obj.cmd];
    if (handle) handle(obj.data);
  }

  /**
  * @desc Wrap methods to prevent unexpected modifications.
  */
  function getWrapper() {
    // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
    // http://developer.mozilla.org/docs/Web/API/Window
    const comm = this;
    const wrapper = {};
    comm.forEach([
      // `eval` should be called directly so that it is run in current scope
      'eval',
    ], name => {
      wrapper[name] = window[name];
    });
    comm.forEach([
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
    comm.forEach(comm.props, name => {
      if (name in wrapper) return;
      if (name.slice(0, 2) === 'on') defineReactedProperty(name);
      else defineProtectedProperty(name);
    });
    return wrapper;
  }
  function initHandler(src, dest) {
    const comm = this;
    comm.sid = comm.vmid + src;
    comm.did = comm.vmid + dest;
    const handle = comm[`handle_${src}`];
    document.addEventListener(comm.sid, e => {
      const data = JSON.parse(e.detail);
      handle.call(comm, data);
    }, false);
    comm.load = comm.noop;
    comm.checkLoad = comm.noop;
  }
  function postData(id, data) {
    // Firefox issue: data must be stringified to avoid cross-origin problem
    const e = new CustomEvent(id, { detail: JSON.stringify(data) });
    document.dispatchEvent(e);
  }
  function getRequest(arg) {
    const comm = this;
    init();
    return comm.getRequest(arg);
    function init() {
      comm.requests = {};
      comm.qrequests = [];
      comm.getRequest = details => {
        const req = {
          details,
          callback,
          start,
          req: {
            abort: reqAbort,
          },
        };
        details.url = getFullUrl(details.url);
        comm.qrequests.push(req);
        comm.post({ cmd: 'GetRequestId' });
        return req.req;
      };
    }
    function reqAbort() {
      comm.post({ cmd: 'AbortRequest', data: this.id });
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
      if (res.type === 'loadend') delete comm.requests[req.id];
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
      comm.requests[id] = req;
      if (comm.includes(['arraybuffer', 'blob'], details.responseType)) {
        data.responseType = 'blob';
      }
      comm.post({ cmd: 'HttpRequest', data });
    }
    function getFullUrl(url) {
      const a = document.createElement('a');
      a.setAttribute('href', url);
      return a.href;
    }
  }
  function wrapGM(script, cache) {
    // Add GM functions
    // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
    const comm = this;
    const gm = {};
    const grant = script.meta.grant || [];
    const urls = {};
    if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
      // @grant none
      grant.pop();
    } else {
      gm.window = comm.getWrapper();
    }
    if (!comm.includes(grant, 'unsafeWindow')) grant.push('unsafeWindow');
    if (!comm.includes(grant, 'GM_info')) grant.push('GM_info');
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
          const data = {
            description: script.meta.description || '',
            excludes: script.meta.exclude.concat(),
            includes: script.meta.include.concat(),
            matches: script.meta.match.concat(),
            name: script.meta.name || '',
            namespace: script.meta.namespace || '',
            resources: {},
            'run-at': script.meta['run-at'] || '',
            unwrap: false,
            version: script.meta.version || '',
          };
          const obj = {};
          addProperty('scriptMetaStr', { value: matches ? matches[1] : '' }, obj);

          // whether update is allowed
          addProperty('scriptWillUpdate', { value: !!script.update }, obj);

          // Violentmonkey specific data
          addProperty('version', { value: comm.version }, obj);
          addProperty('scriptHandler', { value: 'Violentmonkey' }, obj);

          // script object
          addProperty('script', { value: {} }, obj);
          comm.forEach(Object.keys(resources), name => {
            addProperty(name, { value: resources[name] }, data.resources);
          });
          comm.forEach(Object.keys(data), name => {
            addProperty(name, { value: data[name] }, obj.script);
          });
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
            const text = raw && comm.utf8decode(window.atob(raw));
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
          comm.post({ cmd: 'AddStyle', data });
        },
      },
      GM_log: {
        value(data) {
          console.log(`[Violentmonkey][${script.meta.name || 'No name'}]`, data);  // eslint-disable-line no-console
        },
      },
      GM_openInTab: {
        value(url, background) {
          comm.post({ cmd: 'OpenTab', data: { url, active: !background } });
        },
      },
      GM_registerMenuCommand: {
        value(cap, func, acc) {
          comm.command[cap] = func;
          comm.post({ cmd: 'RegisterMenu', data: [cap, acc] });
        },
      },
      GM_xmlhttpRequest: {
        value(details) {
          return comm.getRequest(details);
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
          const id = (comm.notif[''] || 0) + 1;
          comm.notif[''] = id;
          comm.notif[id] = options;
          comm.post({
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
          comm.post({
            cmd: 'SetClipboard',
            data: { type, data },
          });
        },
      },
    };
    comm.forEach(grant, name => {
      const prop = gmFunctions[name];
      if (prop) addProperty(name, prop, gm);
    });
    return gm;
    function getValues() {
      return comm.values[script.uri];
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
      comm.post({
        cmd: 'SetValue',
        data: {
          uri: script.uri,
          values: getValues(),
        },
      });
    }
  }
  function onLoadScripts(data) {
    const comm = this;
    const start = [];
    const idle = [];
    const end = [];
    comm.command = {};
    comm.notif = {};
    comm.ainject = {};
    comm.version = data.version;
    comm.values = {};
    // reset load and checkLoad
    comm.load = () => {
      run(end);
      setTimeout(run, 0, idle);
    };
    comm.checkLoad = () => {
      if (!comm.state && comm.includes(['interactive', 'complete'], document.readyState)) comm.state = 1;
      if (comm.state) comm.load();
    };
    const listMap = {
      'document-start': start,
      'document-idle': idle,
      'document-end': end,
    };
    comm.forEach(data.scripts, script => {
      comm.values[script.uri] = data.values[script.uri] || {};
      if (script && script.enabled) {
        const list = listMap[script.custom['run-at'] || script.meta['run-at']] || end;
        list.push(script);
      }
    });
    run(start);
    comm.checkLoad();
    function buildCode(script) {
      const requireKeys = script.meta.require || [];
      const wrapper = comm.wrapGM(script, data.cache);
      // Must use Object.getOwnPropertyNames to list unenumerable properties
      const wrapperKeys = Object.getOwnPropertyNames(wrapper);
      const wrapperInit = comm.map(wrapperKeys, name => `this["${name}"]=${name}`).join(';');
      const codeSlices = [`${wrapperInit};with(this)!function(){`];
      comm.forEach(requireKeys, key => {
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
      const args = comm.map(wrapperKeys, key => wrapper[key]);
      const thisObj = wrapper.window || wrapper;
      const id = comm.getUniqId();
      comm.ainject[id] = [name, args, thisObj];
      comm.post({ cmd: 'Inject', data: [id, wrapperKeys, code] });
    }
    function run(list) {
      while (list.length) buildCode(list.shift());
    }
  }
  // Communicator
  const comm = {
    vmid: `VM_${getUniqId()}`,
    state: 0,
    utf8decode,
    getUniqId,
    props: Object.getOwnPropertyNames(window),
    noop() {},

    // Array functions
    // Notice: avoid using prototype functions since they may be changed by page scripts
    forEach(arr, func) {
      const length = arr && arr.length;
      for (let i = 0; i < length; i += 1) func(arr[i], i, arr);
    },
    includes(arr, item) {
      const length = arr && arr.length;
      for (let i = 0; i < length; i += 1) {
        if (arr[i] === item) return true;
      }
      return false;
    },
    map(arr, func) {
      const res = [];
      this.forEach(arr, (item, i) => {
        res.push(func(item, i, arr));
      });
      return res;
    },

    init: initHandler,
    postData,
    post(data) {
      return this.postData(this.did, data);
    },
    runCode(name, func, args, thisObj) {
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
    },
    getRequest,
    getWrapper,
    wrapGM,
    onLoadScripts,
  };

  const ids = [];
  const menus = [];
  function injectScript(data) {
    // data: [id, wrapperKeys, code]
    const func = (scriptId, destId, cb, post) => {
      Object.defineProperty(window, `VM_${scriptId}`, {
        value: cb,
        configurable: true,
      });
      post(destId, { cmd: 'Injected', data: scriptId });
    };
    inject(`!${func.toString()}(${JSON.stringify(data[0])},${JSON.stringify(comm.did)},function(${data[1].join(',')}){${data[2]}},${postData.toString()})`);
  }
  function handleContent(req) {
    if (!req) {
      console.error('[Violentmonkey] Invalid data! There might be unsupported data format.');
      return;
    }
    const handlers = {
      GetRequestId: getRequestId,
      HttpRequest: httpRequest,
      AbortRequest: abortRequest,
      Inject: injectScript,
      OpenTab(data) {
        sendMessage({ cmd: 'OpenTab', data });
      },
      SetValue(data) {
        sendMessage({ cmd: 'SetValue', data });
      },
      RegisterMenu(data) {
        if (window.top === window) menus.push(data);
        getPopup();
      },
      AddStyle(css) {
        if (document.head) {
          const style = document.createElement('style');
          style.innerHTML = css;
          document.head.appendChild(style);
        }
      },
      Notification: onNotificationCreate,
      SetClipboard(data) {
        sendMessage({ cmd: 'SetClipboard', data });
      },
    };
    const handle = handlers[req.cmd];
    if (handle) handle(req.data);
  }
  function getPopup() {
    // XXX: only scripts run in top level window are counted
    if (top === window) {
      sendMessage({
        cmd: 'SetPopup',
        data: { ids, menus },
      })
      .catch(comm.noop);
    }
  }

  const notifications = {};
  function onNotificationCreate(options) {
    sendMessage({ cmd: 'Notification', data: options })
    .then(nid => { notifications[nid] = options.id; });
  }
  function onNotificationClick(nid) {
    const id = notifications[nid];
    if (id) comm.post({ cmd: 'NotificationClicked', data: id });
  }
  function onNotificationClose(nid) {
    const id = notifications[nid];
    if (id) {
      comm.post({ cmd: 'NotificationClosed', data: id });
      delete notifications[nid];
    }
  }

  // Messages
  browser.runtime.onMessage.addListener((req, src) => {
    const handlers = {
      Command(data) {
        comm.post({ cmd: 'Command', data });
      },
      GetPopup: getPopup,
      GetBadge: getBadge,
      HttpRequested: httpRequested,
      UpdateValues(data) {
        comm.post({ cmd: 'UpdateValues', data });
      },
      NotificationClick: onNotificationClick,
      NotificationClose: onNotificationClose,
    };
    const handle = handlers[req.cmd];
    if (handle) handle(req.data, src);
  });

  // Requests
  const requests = {};
  function getRequestId() {
    sendMessage({ cmd: 'GetRequestId' })
    .then(id => {
      requests[id] = 1;
      comm.post({ cmd: 'GotRequestId', data: id });
    });
  }
  function httpRequest(details) {
    sendMessage({ cmd: 'HttpRequest', data: details });
  }
  function httpRequested(data) {
    if (requests[data.id]) {
      if (data.type === 'loadend') delete requests[data.id];
      comm.post({ cmd: 'HttpRequested', data });
    }
  }
  function abortRequest(id) {
    sendMessage({ cmd: 'AbortRequest', data: id });
  }

  function objEncode(obj) {
    const list = Object.keys(obj).map(name => {
      const value = obj[name];
      const jsonKey = JSON.stringify(name);
      if (typeof value === 'function') return `${jsonKey}:${value.toString()}`;
      return `${jsonKey}:${JSON.stringify(value)}`;
    });
    return `{${list.join(',')}}`;
  }
  function inject(code) {
    const script = document.createElement('script');
    const doc = document.body || document.documentElement;
    script.innerHTML = code;
    doc.appendChild(script);
    try {
      doc.removeChild(script);
    } catch (e) {
      // ignore if body is changed and script is detached
    }
  }
  function loadScripts(data) {
    comm.forEach(data.scripts, script => {
      ids.push(script.id);
      if (script.enabled) badge.number += 1;
    });
    comm.post({ cmd: 'LoadScripts', data });
    badge.ready = true;
    getPopup();
    setBadge();
  }
  function initCommunicator() {
    const contentId = getUniqId();
    const webId = getUniqId();
    comm[`handle_${webId}`] = handleWeb;
    const initWeb = (comm, webId, contentId) => { // eslint-disable-line no-shadow
      comm.init(webId, contentId);
      document.addEventListener('DOMContentLoaded', () => {
        comm.state = 1;
        comm.load();
      }, false);
      comm.checkLoad();
    };
    inject(`(${initWeb.toString()})(${objEncode(comm)},${JSON.stringify(webId)},${JSON.stringify(contentId)})`);
    comm[`handle_${contentId}`] = handleContent;
    comm.init(contentId, webId);
    sendMessage({ cmd: 'GetInjected', data: location.href }).then(loadScripts);
  }
  initCommunicator();
}());
