// Avoid running repeatedly due to new `document.documentElement`
if (window.VM) return;
window.VM = 1;

function getUniqId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function sendMessage(data) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage(data, function (res) {
      res && res.error ? reject(res.error) : resolve(res && res.data);
    });
  });
}
function includes(arr, item) {
  for (var i = arr.length; i --;) {
    if (arr[i] === item) return true;
  }
  return false;
}
function forEach(arr, func) {
  var length = arr && arr.length || 0;
  for (var i = 0; i < length; i ++) func(arr[i], i, arr);
}
function map(arr, func) {
  var comm = this;
  var res = [];
  comm.forEach(arr, function (item, i) {
    res.push(func(item, i, arr));
  });
  return res;
}

/**
 * http://www.webtoolkit.info/javascript-utf8.html
 */
function utf8decode(utftext) {
  var string = '';
  var i = 0;
  var c = 0, c2 = 0, c3 = 0;
  while ( i < utftext.length ) {
    c = utftext.charCodeAt(i);
    if (c < 128) {
      string += String.fromCharCode(c);
      i ++;
    } else if (c > 191 && c < 224) {
      c2 = utftext.charCodeAt(i + 1);
      string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
      i += 2;
    } else {
      c2 = utftext.charCodeAt(i + 1);
      c3 = utftext.charCodeAt(i + 2);
      string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      i += 3;
    }
  }
  return string;
}

function getPopup(){
  // XXX: only scripts run in top level window are counted
  top === window && sendMessage({
    cmd: 'SetPopup',
    data: {
      ids: ids,
      menus: menus,
    },
  });
}

var badge = {
  number: 0,
  ready: false,
  willSet: false,
};
function getBadge(){
  badge.willSet = true;
  setBadge();
}
function setBadge(){
  if (badge.ready && badge.willSet) {
    // XXX: only scripts run in top level window are counted
    top === window && sendMessage({cmd: 'SetBadge', data: badge.number});
  }
}

/**
 * @desc Wrap methods to prevent unexpected modifications.
 */
function getWrapper() {
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  var comm = this;
  var wrapper = {};
  // `eval` should be called directly so that it is run in current scope
  wrapper.eval = eval;
  // Wrap methods
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
  ], function (name) {
    var method = window[name];
    if (method) wrapper[name] = function () {
      return method.apply(window, arguments);
    };
  });
  function defineProtectedProperty(name) {
    var modified = false;
    var value;
    Object.defineProperty(wrapper, name, {
      get: function () {
        if (!modified) value = window[name];
        return value === window ? wrapper : value;
      },
      set: function (val) {
        modified = true;
        value = val;
      },
    });
  }
  function defineReactedProperty(name) {
    Object.defineProperty(wrapper, name, {
      get: function () {
        var value = window[name];
        return value === window ? wrapper : value;
      },
      set: function (val) {
        window[name] = val;
      },
    });
  }
  // Wrap properties
  comm.forEach(comm.props, function (name) {
    if (wrapper[name]) return;
    if (name.slice(0, 2) === 'on') defineReactedProperty(name);
    else defineProtectedProperty(name);
  });
  return wrapper;
}
// Communicator
var comm = {
  vmid: 'VM_' + getUniqId(),
  state: 0,
  utf8decode: utf8decode,
  getUniqId: getUniqId,
  props: Object.getOwnPropertyNames(window),

  // Array functions
  // Notice: avoid using prototype functions since they may be changed by page scripts
  includes: includes,
  forEach: forEach,
  map: map,

  init: function (srcId, destId) {
    var comm = this;
    comm.sid = comm.vmid + srcId;
    comm.did = comm.vmid + destId;
    document.addEventListener(comm.sid, comm['handle' + srcId].bind(comm), false);
    comm.load = comm.checkLoad = function () {};
    // check whether the page is injectable via <script>, whether limited by CSP
    try {
      comm.injectable = (0, eval)('true');
    } catch (e) {
      comm.injectable = false;
    }
  },
  post: function (data) {
    var e = new CustomEvent(this.did, {detail: data});
    document.dispatchEvent(e);
  },
  handleR: function (e) {
    var obj = e.detail;
    var comm = this;
    var maps = {
      LoadScript: comm.loadScript.bind(comm),
      Command: function (data) {
        var func = comm.command[data];
        func && func();
      },
      GotRequestId: function (id) {
        comm.qrequests.shift().start(id);
      },
      HttpRequested: function (r) {
        var req = comm.requests[r.id];
        if (req) req.callback(r);
      },
      UpdateValues: function (data) {
        var values = comm.values;
        if (values && values[data.uri]) values[data.uri] = data.values;
      },
      NotificationClicked: function (id) {
        var options = comm.notif[id];
        if (options) {
          var onclick = options.onclick;
          onclick && onclick();
        }
      },
      NotificationClosed: function (id) {
        var options = comm.notif[id];
        if (options) {
          delete comm.notif[id];
          var ondone = options.ondone;
          ondone && ondone();
        }
      },
      // advanced inject
      Injected: function (id) {
        var obj = comm.ainject[id];
        var func = window['VM_' + id];
        delete window['VM_' + id];
        delete comm.ainject[id];
        if (obj && func) comm.runCode(obj[0], func, obj[1], obj[2]);
      },
    };
    var func = maps[obj.cmd];
    if (func) func(obj.data);
  },
  runCode: function (name, func, args, thisObj) {
    try {
      func.apply(thisObj, args);
    } catch (e) {
      var msg = 'Error running script: ' + name + '\n' + e;
      if (e.message) msg += '\n' + e.message;
      console.error(msg);
    }
  },
  initRequest: function () {
    // request functions
    function reqAbort(){
      comm.post({cmd: 'AbortRequest', data: this.id});
    }
    function parseData(req, details) {
      if (req.resType) {
        // blob or arraybuffer
        var data = req.data.response.split(',');
        var mimetype = data[0].match(/^data:(.*?);base64$/);
        if (!mimetype) {
          // invalid
          req.data.response = null;
        } else {
          data = window.atob(data[1]);
          var arr = new window.Uint8Array(data.length);
          for (var i = 0; i < data.length; i ++) arr[i] = data.charCodeAt(i);
          if (details.responseType == 'blob') {
            // blob
            return new Blob([arr], {type: mimetype});
          } else {
            // arraybuffer
            return arr.buffer;
          }
        }
      } else if (details.responseType == 'json') {
        // json
        return JSON.parse(req.data.response);
      } else {
        // text
        return req.data.response;
      }
    }
    // request object functions
    function callback(req) {
      var t = this;
      var cb = t.details['on' + req.type];
      if (cb) {
        if (req.data.response) {
          if (!t.data) t.data = [parseData(req, t.details)];
          req.data.response = t.data[0];
        }
        cb(req.data);
      }
      if (req.type == 'loadend') delete comm.requests[t.id];
    }
    function start(id) {
      var t = this;
      var data = {
        id: id,
        method: t.details.method,
        url: t.details.url,
        data: t.details.data,
        //async: !t.details.synchronous,
        user: t.details.user,
        password: t.details.password,
        headers: t.details.headers,
        overrideMimeType: t.details.overrideMimeType,
      };
      t.id = id;
      comm.requests[id] = t;
      if (comm.includes(['arraybuffer', 'blob'], t.details.responseType)) {
        data.responseType = 'blob';
      }
      comm.post({cmd: 'HttpRequest', data: data});
    }
    function getFullUrl(url) {
      var a = document.createElement('a');
      a.setAttribute('href', url);
      return a.href;
    }

    var comm = this;
    comm.requests = {};
    comm.qrequests = [];
    comm.Request = function (details) {
      var t = {
        details: details,
        callback: callback,
        start: start,
        req: {
          abort: reqAbort,
        },
      };
      details.url = getFullUrl(details.url);
      comm.qrequests.push(t);
      comm.post({cmd:'GetRequestId'});
      return t.req;
    };
  },
  getWrapper: getWrapper,
  wrapGM: function (script, cache) {
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
      if (typeof obj[name] == 'function') obj[name].toString = propertyToString;
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
    // Add GM functions
    // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
    var comm = this;
    var gm = {};
    var grant = script.meta.grant || [];
    var urls = {};
    if (!grant.length || grant.length == 1 && grant[0] == 'none') {
      // @grant none
      grant.pop();
    } else {
      gm['window'] = comm.getWrapper();
    }
    if (!comm.includes(grant, 'unsafeWindow')) grant.push('unsafeWindow');
    if (!comm.includes(grant, 'GM_info')) grant.push('GM_info');
    var resources = script.meta.resources || {};
    var gm_funcs = {
      unsafeWindow: {value: window},
      GM_info: {
        get: function () {
          var m = script.code.match(/\/\/\s+==UserScript==\s+([\s\S]*?)\/\/\s+==\/UserScript==\s/);
          var data = {
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
          var obj = {};
          addProperty('scriptMetaStr', {value: m ? m[1] : ''}, obj);

          // whether update is allowed
          addProperty('scriptWillUpdate', {value: !!script.update}, obj);

          // Violentmonkey specific data
          addProperty('version', {value: comm.version}, obj);
          addProperty('scriptHandler', {value: 'Violentmonkey'}, obj);

          // script object
          addProperty('script', {value:{}}, obj);
          var i;
          for (i in data) addProperty(i, {value: data[i]}, obj.script);
          for (i in script.meta.resources) {
            addProperty(i, {value: script.meta.resources[i]}, obj.script.resources);
          }
          return obj;
        },
      },
      GM_deleteValue: {
        value: function (key) {
          var values = getValues();
          delete values[key];
          saveValues();
        },
      },
      GM_getValue: {
        value: function (key, val) {
          var values = getValues();
          var v = values[key];
          if (v) {
            var type = v[0];
            v = v.slice(1);
            switch (type) {
            case 'n':
              val = Number(v);
              break;
            case 'b':
              val = v == 'true';
              break;
            case 'o':
              try {
                val = JSON.parse(v);
              } catch (e) {
                console.warn(e);
              }
              break;
            default:
              val = v;
            }
          }
          return val;
        },
      },
      GM_listValues: {
        value: function () {
          return Object.getOwnPropertyNames(getValues());
        },
      },
      GM_setValue: {
        value: function (key, val) {
          var type = (typeof val)[0];
          switch (type) {
          case 'o':
            val = type + JSON.stringify(val);
            break;
          default:
            val = type + val;
          }
          var values = getValues();
          values[key] = val;
          saveValues();
        },
      },
      GM_getResourceText: {
        value: function (name) {
          for (var i in resources) if (name == i) {
            var text = cache[resources[i]];
            if (text) text = comm.utf8decode(window.atob(text));
            return text;
          }
        },
      },
      GM_getResourceURL: {
        value: function (name) {
          for (var k in resources) if (name == k) {
            var key = resources[k];
            var url = urls[key];
            if (!url) {
              var cc = cache[key];
              if (cc) {
                // Binary string is not supported by blob constructor,
                // so we have to transform it into array buffer.
                var bin = window.atob(cc);
                var arr = new window.Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i ++) {
                  arr[i] = bin.charCodeAt(i);
                }
                var b = new Blob([arr]);
                urls[key] = url = URL.createObjectURL(b);
              } else {
                url = key;
              }
            }
            return url;
          }
        }
      },
      GM_addStyle: {
        value: function (css) {
          comm.post({cmd: 'AddStyle', data: css});
        },
      },
      GM_log: {
        /* eslint-disable no-console */
        value: function (data) {console.log(data);},
        /* eslint-enable no-console */
      },
      GM_openInTab: {
        value: function (url, background) {
          comm.post({cmd: 'OpenTab', data: {url: url, active: !background}});
        },
      },
      GM_registerMenuCommand: {
        value: function (cap, func, acc) {
          comm.command[cap] = func;
          comm.post({cmd: 'RegisterMenu', data: [cap, acc]});
        },
      },
      GM_xmlhttpRequest: {
        value: function (details) {
          if (!comm.Request) comm.initRequest();
          return comm.Request(details);
        },
      },
      GM_notification: {
        value: function (text, title, image, onclick) {
          if (!text) {
            throw 'Invalid parameters.';
          }
          var options = typeof text === 'object' ? text : {
            text: text,
            title: title,
            image: image,
            onclick: onclick,
          };
          var id = comm.notif[''] = (comm.notif[''] || 0) + 1;
          comm.notif[id] = options;
          comm.post({
            cmd: 'Notification',
            data: {
              id: id,
              text: options.text,
              title: options.title,
              image: options.image,
            },
          });
        },
      },
      GM_setClipboard: {
        value: function (text, type) {
          comm.post({
            cmd: 'SetClipboard',
            data: {
              type: type,
              data: text,
            },
          });
        },
      },
    };
    comm.forEach(grant, function (name) {
      var prop = gm_funcs[name];
      prop && addProperty(name, prop, gm);
    });
    return gm;
  },
  loadScript: function (data) {
    function buildCode(script) {
      var require = script.meta.require || [];
      var wrapper = comm.wrapGM(script, data.cache);
      // Must use Object.getOwnPropertyNames to list unenumerable properties
      var wrapperKeys = Object.getOwnPropertyNames(wrapper);
      var code = [
        comm.map(wrapperKeys, function (name) {
          return 'this["' + name + '"]=' + name;
        }).join(';') + ';with(this)!function(){',
      ];
      comm.forEach(require, function (key) {
        var script = data.require[key];
        script && code.push(script);
      });
      // wrap code to make 'use strict' work
      code.push('!function(){' + script.code + '\n}.call(this)');
      code.push('}.call(this);');
      code = code.join('\n');
      var name = script.custom.name || script.meta.name || script.id;
      var args = comm.map(wrapperKeys, function (key) {return wrapper[key];});
      var thisObj = wrapper.window || wrapper;
      if (comm.injectable) {
        // normal injection
        try {
          var func = Function.apply(null, wrapperKeys.concat([code]));
        } catch (e) {
          console.error('Syntax error in script: ' + name + '\n' + e.message);
          return;
        }
        comm.runCode(name, func, args, thisObj);
      } else {
        // advanced injection
        var id = comm.getUniqId();
        comm.ainject[id] = [name, args, thisObj];
        comm.post({cmd: 'Inject', data: [id, wrapperKeys, code]});
      }
    }
    function run(list) {
      while (list.length) buildCode(list.shift());
    }
    var comm = this;
    var start = [];
    var idle = [];
    var end = [];
    comm.command = {};
    comm.notif = {};
    comm.ainject = {};
    comm.version = data.version;
    comm.values = {};
    // reset load and checkLoad
    comm.load = function () {
      run(end);
      setTimeout(run, 0, idle);
    };
    comm.checkLoad = function () {
      if (!comm.state && comm.includes(['interactive', 'complete'], document.readyState))
        comm.state = 1;
      if (comm.state) comm.load();
    };
    var listMap = {
      'document-start': start,
      'document-idle': idle,
      'document-end': end,
    };
    comm.forEach(data.scripts, function (script) {
      comm.values[script.uri] = data.values[script.uri] || {};
      if (script && script.enabled) {
        var list = listMap[script.custom['run-at'] || script.meta['run-at']] || end;
        list.push(script);
      }
    });
    run(start);
    comm.checkLoad();
  },
};

var menus = [];
var ids = [];
function injectScript(data) {
  // data: [id, wrapperKeys, code]
  var func = function (id, did, cb) {
    Object.defineProperty(window, 'VM_' + id, {
      value: cb,
      configurable: true,
    });
    var e = new CustomEvent(did, {detail: {cmd: 'Injected', data: id}});
    document.dispatchEvent(e);
  };
  inject('!' + func.toString() + '(' + JSON.stringify(data[0]) + ',' + JSON.stringify(comm.did) + ',function(' + data[1].join(',') + '){' + data[2] + '})');
}
function handleC(e) {
  var req = e.detail;
  if (!req) {
    console.error('[Violentmonkey] Invalid data! There might be unsupported data format.');
    return;
  }
  var maps = {
    GetRequestId: getRequestId,
    HttpRequest: httpRequest,
    AbortRequest: abortRequest,
    Inject: injectScript,
    OpenTab: function (data) {
      sendMessage({cmd: 'OpenTab', data: data});
    },
    SetValue: function (data) {
      sendMessage({cmd: 'SetValue', data: data});
    },
    RegisterMenu: function (data) {
      if (window.top === window) menus.push(data);
      getPopup();
    },
    AddStyle: function (css) {
      if (document.head) {
        var style = document.createElement('style');
        style.innerHTML = css;
        document.head.appendChild(style);
      }
    },
    Notification: onNotificationCreate,
    SetClipboard: function (data) {
      sendMessage({cmd: 'SetClipboard', data: data});
    },
  };
  var func = maps[req.cmd];
  if (func) func(req.data);
}

var notifications = {};
function onNotificationCreate(options) {
  sendMessage({cmd: 'Notification', data: options})
  .then(function (nid) {
    notifications[nid] = options.id;
  });
}
function onNotificationClick(nid) {
  var id = notifications[nid];
  id && comm.post({cmd: 'NotificationClicked', data: id});
}
function onNotificationClose(nid) {
  var id = notifications[nid];
  if (id) {
    comm.post({cmd: 'NotificationClosed', data: id});
    delete notifications[nid];
  }
}

// Messages
chrome.runtime.onMessage.addListener(function (req, src) {
  var maps = {
    Command: function (data) {
      comm.post({cmd: 'Command', data: data});
    },
    GetPopup: getPopup,
    GetBadge: getBadge,
    HttpRequested: httpRequested,
    UpdateValues: function (data) {
      comm.post({cmd: 'UpdateValues', data: data});
    },
    NotificationClick: onNotificationClick,
    NotificationClose: onNotificationClose,
  };
  var func = maps[req.cmd];
  if (func) func(req.data, src);
});

// Requests
var requests = {};
function getRequestId() {
  sendMessage({cmd: 'GetRequestId'}).then(function (id) {
    requests[id] = 1;
    comm.post({cmd: 'GotRequestId', data: id});
  });
}
function httpRequest(details) {
  sendMessage({cmd: 'HttpRequest', data: details});
}
function httpRequested(data) {
  if (requests[data.id]) {
    if (data.type == 'loadend') delete requests[data.id];
    comm.post({cmd: 'HttpRequested', data: data});
  }
}
function abortRequest(id) {
  sendMessage({cmd: 'AbortRequest', data: id});
}

function objEncode(obj) {
  var list = [];
  for (var i in obj) {
    if (!obj.hasOwnProperty(i)) continue;
    if (typeof obj[i] == 'function') {
      list.push(i + ':' + obj[i].toString());
    } else {
      list.push(i + ':' + JSON.stringify(obj[i]));
    }
  }
  return '{' + list.join(',') + '}';
}
function inject(code) {
  var script = document.createElement('script');
  var doc = document.body || document.documentElement;
  script.innerHTML = code;
  doc.appendChild(script);
  try {
    doc.removeChild(script);
  } catch (e) {
    // ignore if body is changed and script is detached
  }
}
function loadScript(data) {
  forEach(data.scripts, function (script) {
    ids.push(script.id);
    if (script.enabled) badge.number ++;
  });
  comm.post({cmd: 'LoadScript', data: data});
  badge.ready = true;
  getPopup();
  setBadge();
}
function initCommunicator() {
  var C = 'C';
  var R = 'R';
  inject(
    '!function(c,R,C){c.init(R,C);document.addEventListener("DOMContentLoaded",function(e){c.state=1;c.load();},false);c.checkLoad();}(' +
    objEncode(comm) + ',"' + R + '","' + C + '")'
  );
  comm.handleC = handleC;
  comm.init(C, R);
  sendMessage({cmd: 'GetInjected', data: location.href}).then(loadScript);
}
initCommunicator();
