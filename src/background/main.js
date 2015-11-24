var vmdb = new VMDB;
var port = null;
var vm_ver = chrome.app.getDetails().version;

vmdb.initialized.then(function () {
  var commands = {
    NewScript: function (data, src) {
      return Promise.resolve(newScript());
    },
    RemoveScript: removeScript,
    GetData: getData,
    GetInjected: getInjected,
    CheckUpdate: checkUpdate,
    CheckUpdateAll: checkUpdateAll,
    UpdateMeta: updateMeta,
    SetValue: setValue,
    ExportZip: exportZip,
    ParseScript: parseScript,
    GetScript: getScript,
    GetMetas: getMetas,
    SetBadge: setBadge,
    AutoUpdate: autoUpdate,
    Vacuum: vacuum,
    Move: move,
    ParseMeta: function(o, src, callback) {callback(parseMeta(o));},
    GetRequestId: getRequestId,
    HttpRequest: httpRequest,
    AbortRequest: abortRequest,
  };
  chrome.runtime.onMessage.addListener(function (req, src, callback) {
    var func = commands[req.cmd];
    if (func) {
      var res = func(req.data, src);
      if (res === false) return;
      var finish = function () {
        try {
          callback.apply(null, arguments);
        } catch (e) {
          // callback fails if not given in content page
        }
      };
      res.then(finish, finish);
      return true;
    }
  });
  setTimeout(autoUpdate, 2e4);
});

// Common functions

function compareVersion(version1, version2) {
  version1 = (version1 || '').split('.');
  version2 = (version2 || '').split('.');
  for ( var i = 0; i < version1.length || i < version2.length; i ++ ) {
    var delta = (parseInt(version1[i], 10) || 0) - (parseInt(version2[i], 10) || 0);
    if(delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function notify(options) {
  chrome.notifications.create(options.id || 'ViolentMonkey', {
    type: 'basic',
    iconUrl: '/images/icon128.png',
    title: options.title + ' - ' + _.i18n('extName'),
    message: options.body,
    isClickable: options.isClickable,
  });
}

function isRemote(url){
  return url && !/^data:/.test(url);
}

function getMeta(script) {
  return {
    id: script.id,
    custom: script.custom,
    meta: script.meta,
    enabled: script.enabled,
    update: script.update,
  };
}

function vacuum(o, src, callback) {
  function init(){
    var o = db.transaction('scripts').objectStore('scripts');
    o.index('position').openCursor().onsuccess = function (e) {
      var r = e.target.result;
      if (r) {
        var script = r.value;
        ids.push(script.id);
        script.meta.require.forEach(function (item) {require[item] = 1;});
        for(var i in script.meta.resources) cache[script.meta.resources[i]] = 1;
        if(isRemote(script.meta.icon)) cache[script.meta.icon] = 1;
        values[script.uri] = 1;
        r.continue();
      } else vacuumPosition();
    };
  }
  function vacuumPosition() {
    var id = ids.shift();
    if (id) {
      var o = db.transaction('scripts','readwrite').objectStore('scripts');
      o.get(id).onsuccess = function (e) {
        var r = e.target.result;
        r.position = ++ _pos;
        o.put(r).onsuccess = vacuumPosition;
      };
    } else {
      position = _pos;
      vacuumDB('require', require);
      vacuumDB('cache', cache);
      vacuumDB('values', values);
    }
  }
  function vacuumDB(dbName, dict) {
    working ++;
    // the database must have a keyPath of 'uri'
    var o = db.transaction(dbName, 'readwrite').objectStore(dbName);
    o.openCursor().onsuccess = function (e) {
      var r = e.target.result;
      if (r) {
        var v = r.value;
        if (!dict[v.uri]) o.delete(v.uri);
        else dict[v.uri] ++;  // keep
        r.continue();
      } else finish();
    };
  }
  function finish() {
    if(! -- working) {
      for(var i in require)
        if(require[i] == 1) fetchRequire(i);
      for(i in cache)
        if(cache[i] == 1) fetchCache(i);
      callback();
    }
  }
  var ids = [];
  var cache = {};
  var require = {};
  var values = {};
  var working = 0;
  var _pos=0;
  init();
  return true;
}

var badges = {};
function setBadge(num, src, callback) {
  var o;
  if(src.id in badges) o = badges[src.id];
  else badges[src.id] = o = {num: 0};
  o.num += num;
  chrome.browserAction.setBadgeBackgroundColor({color: '#808', tabId: src.tab.id});
  chrome.browserAction.setBadgeText({
    text: o.num ? o.num.toString() : '',
    tabId: src.tab.id,
  });
  if(o.timer) clearTimeout(o.timer);
  o.timer = setTimeout(function(){delete badges[src.id];}, 300);
  callback();
}

function getInjected(url, src, callback) {
  function getScripts(){
    var o = db.transaction('scripts').objectStore('scripts');
    var require = {};
    var cache = {};
    var values = [];
    o.index('position').openCursor().onsuccess = function (e) {
      var r = e.target.result;
      if (r) {
        var v = r.value;
        if (testURL(url, v)) {
          data.scripts.push(v);
          values.push(v.uri);
          v.meta.require.forEach(function(i){require[i] = 1;});
          for(var i in v.meta.resources) cache[v.meta.resources[i]] = 1;
        }
        r.continue();
      } else {
        count = 3;
        getRequire(Object.getOwnPropertyNames(require));
        getCacheB64(Object.getOwnPropertyNames(cache), function (cache) {
          data.cache = cache;
          finish();
        });
        getValues(values);
      }
    };
  }
  function getRequire(require) {
    function loop() {
      var uri = require.pop();
      if(uri)
        o.get(uri).onsuccess = function(e) {
          var r = e.target.result;
          if (r) data.require[uri] = r.code;
          loop();
        };
      else finish();
    }
    var o = db.transaction('require').objectStore('require');
    loop();
  }
  function getValues(values) {
    function loop(){
      var uri = values.pop();
      if (uri)
        o.get(uri).onsuccess = function (e) {
          var v = e.target.result;
          if (v) data.values[uri] = v.values;
          loop();
        };
      else finish();
    }
    var o = db.transaction('values').objectStore('values');
    loop();
  }
  function finish(){
    if (! -- count) {
      callback(data);
      if(src.url == src.tab.url)
        chrome.tabs.sendMessage(src.tab.id, {cmd: 'GetBadge'});
    }
  }
  var data = {
    scripts: [],
    values: {},
    require: {},
    injectMode: _.options.get('injectMode'),
    version: vm_ver,
  };
  var count = 1;
  if (data.isApplied = _.options.get('isApplied')) getScripts();
  else finish();
  return true;
}

function fetchURL(url, cb, type, headers) {
  var req = new XMLHttpRequest();
  req.open('GET', url, true);
  if (type) req.responseType = type;
  if (headers) for(var i in headers)
    req.setRequestHeader(i, headers[i]);
  if(cb) req.onloadend = cb;
  req.send();
}

function updateItem(data) {
  if (port) try {
    port.postMessage(data);
  } catch(e) {
    port = null;
    console.log(e);
  }
}

function parseScript(data, src, callback) {
  function finish() {
    updateItem(ret);
    if (callback) callback(ret);
  }
  var ret = {
    cmd: 'update',
    data: {
      message: 'message' in data ? data.message : _.i18n('msgUpdated'),
    },
  };
  if (data.status && data.status != 200 || data.code == '') {
    // net error
    ret.cmd = 'error';
    ret.data.message = _.i18n('msgErrorFetchingScript');
    finish();
  } else {
    // store script
    var meta = parseMeta(data.code);
    queryScript(data.id, meta, function(script) {
      if (!script.id) {
        ret.cmd = 'add';
        ret.data.message = _.i18n('msgInstalled');
      }
      // add additional data for import and user edit
      if (data.more)
        for(var i in data.more)
          if(i in script) script[i] = data.more[i];
      script.meta = meta;
      script.code = data.code;
      script.uri = getNameURI(script);
      // use referer page as default homepage
      if (data.from && !script.meta.homepageURL && !script.custom.homepageURL && !/^(file|data):/.test(data.from))
        script.custom.homepageURL = data.from;
      if (data.url && !/^(file|data):/.test(data.url))
        script.custom.lastInstallURL = data.url;
      saveScript(script).onsuccess = function(e) {
        script.id = e.target.result;
        Object.assign(ret.data, getMeta(script));
        finish();
        if (!meta.grant.length && !_.options.get('ignoreGrant'))
          notify({
            id: 'VM-NoGrantWarning',
            title: _.i18n('Warning'),
            body: _.i18n('msgWarnGrant', [meta.name||_.i18n('labelNoName')]),
            isClickable: true,
          });
      };
    });
    // @require
    meta.require.forEach(function (url) {
      var cache = data.require && data.require[url];
      if(cache) saveRequire(url, cache);
      else fetchRequire(url);
    });
    // @resource
    for(var i in meta.resources) {
      var url = meta.resources[i];
      var cache = data.resources && data.resources[url];
      if(cache) saveCache(url, cache);
      else fetchCache(url);
    }
    // @icon
    if(isRemote(meta.icon)) fetchCache(meta.icon, function (blob, cb) {
      var free = function() {
        URL.revokeObjectURL(url);
      };
      var url = URL.createObjectURL(blob);
      var image = new Image;
      image.onload = function() {
        free();
        cb(blob);
      };
      image.onerror = function() {
        free();
      };
      image.src = url;
    });
  }
  return true;
}

var _update = {};
function realCheckUpdate(script) {
  function update() {
    if(downloadURL) {
      ret.data.message = _.i18n('msgUpdating');
      fetchURL(downloadURL, function(){
        parseScript({
          id: script.id,
          status: this.status,
          code: this.responseText,
        });
      });
    } else ret.data.message = '<span class=new>' + _.i18n('msgNewVersion') + '</span>';
    updateItem(ret);
    finish();
  }
  function finish(){
    delete _update[script.id];
  }
  if (_update[script.id]) return;
  _update[script.id] = 1;
  var ret = {
    cmd: 'update',
    data: {
      id: script.id,
      updating: true,
    },
  };
  var downloadURL =
    script.custom.downloadURL ||
    script.meta.downloadURL ||
    script.custom.lastInstallURL;
  var updateURL =
    script.custom.updateURL ||
    script.meta.updateURL ||
    downloadURL;
  if(updateURL) {
    ret.data.message = _.i18n('msgCheckingForUpdate');
    updateItem(ret);
    fetchURL(updateURL, function() {
      ret.data.message = _.i18n('msgErrorFetchingUpdateInfo');
      if (this.status == 200)
        try {
          var meta = parseMeta(this.responseText);
          if(compareVersion(script.meta.version, meta.version) < 0)
            return update();
          ret.data.message = _.i18n('msgNoUpdate');
        } catch(e) {}
      ret.data.updating = false;
      updateItem(ret);
      finish();
    }, null, {
      Accept:'text/x-userscript-meta',
    });
  } else finish();
}

function checkUpdate(id, src, callback) {
  var o = db.transaction('scripts').objectStore('scripts');
  o.get(id).onsuccess = function (e) {
    var script = e.target.result;
    if(script) realCheckUpdate(script);
    if(callback) callback();
  };
  return true;
}

function checkUpdateAll(e, src, callback) {
  _.options.set('lastUpdate', Date.now());
  var o = db.transaction('scripts').objectStore('scripts');
  o.index('update').openCursor(1).onsuccess = function (e) {
    var r = e.target.result;
    if (r) {
      realCheckUpdate(r.value);
      r.continue();
    } else if(callback) callback();
  };
  return true;
}

var _autoUpdate = false;
function autoUpdate(data, src, callback) {
  function check() {
    if(_.options.get('autoUpdate')) {
      if (Date.now() - _.options.get('lastUpdate') >= 864e5)
        checkUpdateAll();
      setTimeout(check, 36e5);
    } else _autoUpdate = false;
  }
  if (!_autoUpdate) {
    _autoUpdate = true;
    check();
  }
  if (callback) callback();
}

chrome.runtime.onConnect.addListener(function (_port) {
  port = _port;
  _port.onDisconnect.addListener(function () {port = null;});
});

chrome.browserAction.setIcon({
  path: '/images/icon19' + (_.options.get('isApplied') ? '' : 'w') + '.png',
});

chrome.notifications.onClicked.addListener(function(id) {
  if(id == 'VM-NoGrantWarning')
    chrome.tabs.create({url: 'http://wiki.greasespot.net/@grant'});
});
