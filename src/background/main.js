var vmdb = new VMDB;
var VM_VER = chrome.app.getDetails().version;
var commands = {
  NewScript: function (data, src) {
    return Promise.resolve(scriptUtils.newScript());
  },
  RemoveScript: function (id, src) {
    return vmdb.removeScript(id);
  },
  GetData: function (data, src) {
    return vmdb.getData();
  },
  GetInjected: function (url, src) {
    var data = {
      isApplied: _.options.get('isApplied'),
      injectMode: _.options.get('injectMode'),
      version: VM_VER,
    };
    if(src.url == src.tab.url)
      chrome.tabs.sendMessage(src.tab.id, {cmd: 'GetBadge'});
    return data.isApplied
    ? vmdb.getScriptsByURL(url).then(function (res) {
      return _.assign(data, res);
    }) : Promise.resolve(data);
  },
  UpdateScriptInfo: function (data, src) {
    return vmdb.updateScriptInfo(data.id, data).then(function (script) {
      _.messenger.post({
        cmd: 'update',
        data: script,
      });
    });
  },
  SetValue: function (data, src) {
    return vmdb.setValue(data.uri, data.values)
    .then(function () {
      _.broadcast({
        cmd: 'UpdateValues',
        data: {
          uri: data.uri,
          values: data.values,
        },
      });
    });
  },
  ExportZip: function (data, src) {
    return vmdb.getExportData(data.ids, data.values);
  },
  GetScript: function (id, src) {
    return vmdb.getScriptData(id);
  },
  GetMetas: function (ids, src) {
    return vmdb.getScriptInfos(ids);
  },
  Move: function (data, src) {
    return vmdb.moveScript(data.id, data.offset);
  },
  Vacuum: function (data, src) {
    return vmdb.vacuum();
  },
  ParseScript: function (data, src) {
    return vmdb.parseScript(data).then(function (res) {
      var meta = res.data.meta;
      if (!meta.grant.length && !_.options.get('ignoreGrant'))
        notify({
          id: 'VM-NoGrantWarning',
          title: _.i18n('Warning'),
          body: _.i18n('msgWarnGrant', [meta.name||_.i18n('labelNoName')]),
          isClickable: true,
        });
      _.messenger.post(res);
      return res.data;
    });
  },
  CheckUpdate: function (id, src) {
    vmdb.getScript(id).then(vmdb.checkUpdate);
    return false;
  },
  CheckUpdateAll: function (data, src) {
    _.options.set('lastUpdate', Date.now());
    vmdb.getScriptsByIndex('update', 1).then(function (scripts) {
      return Promise.all(scripts.map(vmdb.checkUpdate));
    });
    return false;
  },
  ParseMeta: function (code, src) {
    return Promise.resolve(scriptUtils.parseMeta(code));
  },
  AutoUpdate: autoUpdate,
  GetRequestId: function (data, src) {
    return Promise.resolve(requests.getRequestId());
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
  AbortRequest: function (id, src) {
    return Promise.resolve(requests.abortRequest(id));
  },
  SetBadge: function (num, src) {
    setBadge(num, src);
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
      res.then(function (data) {
        finish({
          data: data,
          error: null,
        });
      }, function (data) {
        finish({
          error: data,
        });
      });
      return true;
    }
  });
  setTimeout(autoUpdate, 2e4);
});

// Common functions

function notify(options) {
  chrome.notifications.create(options.id || 'ViolentMonkey', {
    type: 'basic',
    iconUrl: '/images/icon128.png',
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
    chrome.browserAction.setBadgeText({
      text: (o.num || '').toString(),
      tabId: src.tab.id,
    });
    if (o.timer) clearTimeout(o.timer);
    o.timer = setTimeout(function () {
      delete badges[src.id];
    }, 300);
  };
}();

var autoUpdate = function () {
  function check() {
    checking = true;
    return new Promise(function (resolve, reject) {
      if (!_.options.get('autoUpdate')) return reject();
      if (Date.now() - _.options.get('lastUpdate') >= 864e5)
        return commands.CheckUpdateAll();
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

_.messenger = function () {
  var port;
  chrome.runtime.onConnect.addListener(function (_port) {
    port = _port;
    _port.onDisconnect.addListener(function () {
      if (port === _port) port = null;
    });
  });

  return {
    post: function (data) {
      try {
        port && port.postMessage(data);
      } catch (e) {
        console.log(e);
        port = null;
      }
    },
    send: function (tabId, data) {
      chrome.tabs.sendMessage(tabId, data);
    },
  };
}();

!function (isApplied) {
  chrome.browserAction.setIcon({
    path: {
      19: '/images/icon19' + (isApplied ? '' : 'w') + '.png',
      38: '/images/icon38' + (isApplied ? '' : 'w') + '.png'
    },
  });
}(_.options.get('isApplied'));

chrome.notifications.onClicked.addListener(function(id) {
  if(id == 'VM-NoGrantWarning')
    chrome.tabs.create({url: 'http://wiki.greasespot.net/@grant'});
});
