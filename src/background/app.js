var _ = require('src/common');
var VMDB = require('./db');
var sync = require('./sync');
var requests = require('./requests');
var cache = require('./utils/cache');
var tabsUtils = require('./utils/tabs');
var scriptUtils = require('./utils/script');
var clipboard = require('./utils/clipboard');
var options = require('./options');

var vmdb = exports.vmdb = new VMDB;
var VM_VER = chrome.app.getDetails().version;

options.hook(function (changes) {
  if ('isApplied' in changes) {
    setIcon(changes.isApplied);
  }
  _.messenger.post({
    cmd: 'UpdateOptions',
    data: changes,
  });
});

var autoUpdate = function () {
  function check() {
    checking = true;
    return new Promise(function (resolve, reject) {
      if (!options.get('autoUpdate')) return reject();
      if (Date.now() - options.get('lastUpdate') >= 864e5)
        resolve(commands.CheckUpdateAll());
    }).then(function () {
      setTimeout(check, 36e5);
    }, function () {
      checking = false;
    });
  }
  var checking;
  return function () {
    checking || check();
  };
}();
var commands = {
  NewScript: function (_data, _src) {
    return scriptUtils.newScript();
  },
  RemoveScript: function (id, _src) {
    return vmdb.removeScript(id)
    .then(function () {
      sync.sync();
    });
  },
  GetData: function (_data, _src) {
    return vmdb.getData().then(function (data) {
      data.sync = sync.states();
      data.version = VM_VER;
      return data;
    });
  },
  GetInjected: function (url, src) {
    var data = {
      isApplied: options.get('isApplied'),
      injectMode: options.get('injectMode'),
      version: VM_VER,
    };
    if (src.tab && src.url === src.tab.url) {
      chrome.tabs.sendMessage(src.tab.id, {cmd: 'GetBadge'});
    }
    return data.isApplied
      ? vmdb.getScriptsByURL(url).then(function (res) {
        return Object.assign(data, res);
      }) : data;
  },
  UpdateScriptInfo: function (data, _src) {
    return vmdb.updateScriptInfo(data.id, data, {
      modified: Date.now(),
    })
    .then(function (script) {
      sync.sync();
      _.messenger.post({
        cmd: 'UpdateScript',
        data: script,
      });
    });
  },
  SetValue: function (data, _src) {
    return vmdb.setValue(data.uri, data.values)
    .then(function () {
      tabsUtils.broadcast({
        cmd: 'UpdateValues',
        data: {
          uri: data.uri,
          values: data.values,
        },
      });
    });
  },
  ExportZip: function (data, _src) {
    return vmdb.getExportData(data.ids, data.values);
  },
  GetScript: function (id, _src) {
    return vmdb.getScriptData(id);
  },
  GetMetas: function (ids, _src) {
    return vmdb.getScriptInfos(ids);
  },
  Move: function (data, _src) {
    return vmdb.moveScript(data.id, data.offset);
  },
  Vacuum: function (_data, _src) {
    return vmdb.vacuum();
  },
  ParseScript: function (data, _src) {
    return vmdb.parseScript(data).then(function (res) {
      var meta = res.data.meta;
      if (!meta.grant.length && !options.get('ignoreGrant'))
        notify({
          id: 'VM-NoGrantWarning',
          title: _.i18n('Warning'),
          body: _.i18n('msgWarnGrant', [meta.name||_.i18n('labelNoName')]),
          isClickable: true,
        });
      _.messenger.post(res);
      sync.sync();
      return res.data;
    });
  },
  CheckUpdate: function (id, _src) {
    vmdb.getScript(id).then(vmdb.checkUpdate);
    return false;
  },
  CheckUpdateAll: function (_data, _src) {
    options.set('lastUpdate', Date.now());
    vmdb.getScriptsByIndex('update', 1).then(function (scripts) {
      return Promise.all(scripts.map(vmdb.checkUpdate));
    });
    return false;
  },
  ParseMeta: function (code, _src) {
    return scriptUtils.parseMeta(code);
  },
  AutoUpdate: autoUpdate,
  GetRequestId: function (_data, _src) {
    return requests.getRequestId();
  },
  HttpRequest: function (details, src) {
    requests.httpRequest(details, function (res) {
      _.messenger.send(src.tab.id, {
        cmd: 'HttpRequested',
        data: res,
      });
    });
    return false;
  },
  AbortRequest: function (id, _src) {
    return requests.abortRequest(id);
  },
  SetBadge: function (num, src) {
    setBadge(num, src);
    return false;
  },
  SyncAuthorize: function (_data, _src) {
    sync.authorize();
    return false;
  },
  SyncRevoke: function (_data, _src) {
    sync.revoke();
    return false;
  },
  SyncStart: function (_data, _src) {
    sync.sync();
    return false;
  },
  GetFromCache: function (data, _src) {
    return cache.get(data) || null;
  },
  Notification: function (data, _src) {
    return new Promise(function (resolve) {
      chrome.notifications.create({
        type: 'basic',
        title: data.title || _.i18n('extName'),
        message: data.text,
        iconUrl: data.image || _.defaultImage,
      }, function (id) {
        resolve(id);
      });
    });
  },
  SetClipboard: function (data, _src) {
    clipboard.set(data);
    return false;
  },
  OpenTab: function (data, _src) {
    chrome.tabs.create({
      url: data.url,
      active: data.active,
    });
    return false;
  },
  GetAllOptions: function (_data, _src) {
    return options.getAll();
  },
  GetOptions: function (data, _src) {
    return data.reduce(function (res, key) {
      res[key] = options.get(key);
      return res;
    }, {});
  },
  SetOptions: function (data, _src) {
    if (!Array.isArray(data)) data = [data];
    data.forEach(function (item) {
      options.set(item.key, item.value);
    });
    return false;
  },
};

vmdb.initialized.then(function () {
  chrome.runtime.onMessage.addListener(function (req, src, callback) {
    var func = commands[req.cmd];
    if (func) {
      var res = func(req.data, src);
      if (res === false) return;
      var finish = function (data) {
        try {
          callback(data);
        } catch (e) {
          // callback fails if not given in content page
        }
      };
      Promise.resolve(res).then(function (data) {
        finish({
          data: data,
          error: null,
        });
      }, function (data) {
        if (data instanceof Error) {
          console.error(data);
          data = data.toString();
        }
        finish({
          error: data,
        });
      });
      return true;
    }
  });
  setTimeout(autoUpdate, 2e4);
  sync.initialize();
});

// Common functions

function notify(options) {
  chrome.notifications.create(options.id || 'ViolentMonkey', {
    type: 'basic',
    iconUrl: _.defaultImage,
    title: options.title + ' - ' + _.i18n('extName'),
    message: options.body,
    isClickable: options.isClickable,
  });
}

var setBadge = function () {
  var badges = {};
  return function (num, src) {
    var o = badges[src.id];
    if (!o) o = badges[src.id] = {num: 0};
    o.num += num;
    chrome.browserAction.setBadgeBackgroundColor({
      color: '#808',
      tabId: src.tab.id,
    });
    var text = (options.get('showBadge') && o.num || '').toString();
    chrome.browserAction.setBadgeText({
      text: text,
      tabId: src.tab.id,
    });
    if (o.timer) clearTimeout(o.timer);
    o.timer = setTimeout(function () {
      delete badges[src.id];
    }, 300);
  };
}();

_.messenger = function () {
  return {
    post: function (data) {
      chrome.runtime.sendMessage(data);
    },
    send: function (tabId, data) {
      chrome.tabs.sendMessage(tabId, data);
    },
  };
}();

function setIcon(isApplied) {
  chrome.browserAction.setIcon({
    path: {
      19: '/images/icon19' + (isApplied ? '' : 'w') + '.png',
      38: '/images/icon38' + (isApplied ? '' : 'w') + '.png'
    },
  });
}
setIcon(options.get('isApplied'));

chrome.notifications.onClicked.addListener(function (id) {
  if (id == 'VM-NoGrantWarning') {
    tabsUtils.create('http://wiki.greasespot.net/@grant');
  } else {
    tabsUtils.broadcast({
      cmd: 'NotificationClick',
      data: id,
    });
  }
});

chrome.notifications.onClosed.addListener(function (id) {
  tabsUtils.broadcast({
    cmd: 'NotificationClose',
    data: id,
  });
});
