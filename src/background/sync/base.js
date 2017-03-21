var _ = require('src/common');
var events = require('../utils/events');
var app = require('../app');
var options = require('../options');

var serviceNames = [];
var services = {};
var autoSync = _.debounce(function () {
  sync();
}, 60 * 60 * 1000);
var working = Promise.resolve();
var syncConfig = initConfig();

function getFilename(uri) {
  return 'vm-' + encodeURIComponent(uri);
}
function isScriptFile(name) {
  return /^vm-/.test(name);
}
function getURI(name) {
  return decodeURIComponent(name.slice(3));
}

function initConfig() {
  function get(key, def) {
    var keys = _.normalizeKeys(key);
    keys.unshift('sync');
    return options.get(keys, def);
  }
  function set(key, value) {
    var keys = _.normalizeKeys(key);
    keys.unshift('sync');
    options.set(keys, value);
  }
  function init() {
    var sync = options.get('sync');
    if (!sync || !sync.services) {
      sync = {
        services: {},
      };

      // XXX Migrate from old data
      ['dropbox', 'onedrive']
      .forEach(function (key) {
        sync.services[key] = options.get(key);
      });

      set([], sync);
    }
  }
  init();
  return {get: get, set: set};
}

function ServiceConfig(name) {
  this.name = name;
}
ServiceConfig.prototype.normalizeKeys = function (key) {
  var keys = _.normalizeKeys(key);
  keys.unshift('services', this.name);
  return keys;
};
ServiceConfig.prototype.get = function (key, def) {
  var keys = this.normalizeKeys(key);
  return syncConfig.get(keys, def);
};
ServiceConfig.prototype.set = function (key, val) {
  var _this = this;
  if (typeof key === 'object') {
    var data = key;
    Object.keys(data).forEach(function (key) {
      var keys = _this.normalizeKeys(key);
      syncConfig.set(keys, data[key]);
    });
  } else {
    var keys = _this.normalizeKeys(key);
    syncConfig.set(keys, val);
  }
};
ServiceConfig.prototype.clear = function () {
  syncConfig.set(this.normalizeKeys(), {});
};

function serviceState(validStates, initialState, onChange) {
  var state = initialState || validStates[0];
  return {
    get: function () {return state;},
    set: function (_state) {
      if (~validStates.indexOf(_state)) {
        state = _state;
        onChange && onChange();
      } else {
        console.warn('Invalid state:', _state);
      }
      return state;
    },
    is: function (states) {
      if (!Array.isArray(states)) states = [states];
      return ~states.indexOf(state);
    },
  };
}
function getStates() {
  return serviceNames.map(function (name) {
    var service = services[name];
    return {
      name: service.name,
      displayName: service.displayName,
      authState: service.authState.get(),
      syncState: service.syncState.get(),
      lastSync: service.config.get('meta', {}).lastSync,
      progress: service.progress,
    };
  });
}

function serviceFactory(base, options) {
  var Service = function () {
    this.initialize.apply(this, arguments);
  };
  Service.prototype = Object.assign(Object.create(base), options);
  Service.extend = extendService;
  return Service;
}
function extendService(options) {
  return serviceFactory(this.prototype, options);
}
var BaseService = serviceFactory({
  name: 'base',
  displayName: 'BaseService',
  delayTime: 1000,
  urlPrefix: '',
  metaFile: 'Violentmonkey',
  delay: function (time) {
    if (time == null) time = this.delayTime;
    return new Promise(function (resolve, _reject) {
      setTimeout(resolve, time);
    });
  },
  initialize: function (name) {
    var _this = this;
    _this.onStateChange = _.debounce(_this.onStateChange.bind(_this));
    if (name) _this.name = name;
    _this.progress = {
      finished: 0,
      total: 0,
    };
    _this.config = new ServiceConfig(_this.name);
    _this.authState = serviceState([
      'idle',
      'initializing',
      'authorizing',  // in case some services require asynchronous requests to get access_tokens
      'authorized',
      'unauthorized',
      'error',
    ], null, _this.onStateChange);
    _this.syncState = serviceState([
      'idle',
      'ready',
      'syncing',
      'error',
    ], null, _this.onStateChange);
    // _this.initToken();
    _this.events = events.getEventEmitter();
    _this.lastFetch = Promise.resolve();
    _this.startSync = _this.syncFactory();
  },
  on: function () {
    return this.events.on.apply(null, arguments);
  },
  off: function () {
    return this.events.off.apply(null, arguments);
  },
  fire: function () {
    return this.events.fire.apply(null, arguments);
  },
  onStateChange: function () {
    browser.runtime.sendMessage({
      cmd: 'UpdateSync',
      data: getStates(),
    });
  },
  log: function () {
    console.log.apply(console, arguments);  // eslint-disable-line no-console
  },
  syncFactory: function () {
    var _this = this;
    var promise, debouncedResolve;
    function shouldSync() {
      return _this.authState.is('authorized') && getCurrent() === _this.name;
    }
    function init() {
      if (!shouldSync()) return Promise.resolve();
      _this.log('Ready to sync:', _this.displayName);
      _this.syncState.set('ready');
      promise = working = working.then(function () {
        return new Promise(function (resolve, _reject) {
          debouncedResolve = _.debounce(resolve, 10 * 1000);
          debouncedResolve();
        });
      })
      .then(function () {
        if (shouldSync()) {
          return _this.sync();
        }
        _this.syncState.set('idle');
      })
      .catch(function (err) {
        console.error(err);
      })
      .then(function () {
        promise = debouncedResolve = null;
      });
    }
    return function () {
      if (!promise) init();
      debouncedResolve && debouncedResolve();
      return promise;
    };
  },
  prepareHeaders: function () {
    this.headers = {};
  },
  prepare: function () {
    var _this = this;
    _this.authState.set('initializing');
    return (_this.initToken() ? Promise.resolve(_this.user()) : Promise.reject({
      type: 'unauthorized',
    }))
    .then(function () {
      _this.authState.set('authorized');
    }, function (err) {
      if (err.type === 'unauthorized') {
        // _this.config.clear();
        _this.authState.set('unauthorized');
      } else {
        console.error(err);
        _this.authState.set('error');
      }
      _this.syncState.set('idle');
      throw err;
    });
  },
  checkSync: function () {
    var _this = this;
    return _this.prepare()
    .then(function () {
      return _this.startSync();
    });
  },
  user: _.noop,
  getMeta: function () {
    var _this = this;
    return _this.get(_this.metaFile)
    .then(function (data) {
      return JSON.parse(data);
    });
  },
  initToken: function () {
    var _this = this;
    _this.prepareHeaders();
    var token = _this.config.get('token');
    if (token) {
      _this.headers.Authorization = 'Bearer ' + token;
      return true;
    }
  },
  request: function (options) {
    var _this = this;
    var progress = _this.progress;
    var lastFetch;
    if (options.noDelay) {
      lastFetch = Promise.resolve();
    } else {
      lastFetch = _this.lastFetch;
      _this.lastFetch = lastFetch.then(function () {
        return _this.delay();
      });
    }
    progress.total ++;
    _this.onStateChange();
    return lastFetch.then(function () {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest;
        var prefix = options.prefix;
        if (prefix == null) prefix = _this.urlPrefix;
        xhr.open(options.method || 'GET', prefix + options.url, true);
        var headers = Object.assign({}, _this.headers, options.headers);
        if (options.body && typeof options.body === 'object') {
          headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(options.body);
        }
        Object.keys(headers).forEach(function (key) {
          var v = headers[key];
          v && xhr.setRequestHeader(key, v);
        });
        xhr.onloadend = function () {
          progress.finished ++;
          var data = xhr.responseText;
          if (options.responseType === 'json') {
            try {
              data = JSON.parse(data);
            } catch (e) {
              // Invalid JSON data
            }
          }
          _this.onStateChange();
          if (xhr.status === 503) {
            // TODO Too Many Requests
          }
          // net error: xhr.status === 0
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            requestError(data);
          }
        };
        xhr.send(options.body);

        function requestError(data) {
          reject({
            url: options.url,
            status: xhr.status,
            xhr: xhr,
            data: data,
          });
        }
      });
    });
  },
  sync: function () {
    var _this = this;
    _this.progress = {
      finished: 0,
      total: 0,
    };
    _this.syncState.set('syncing');
    return _this.getMeta()
    .then(function (meta) {
      return Promise.all([
        meta,
        _this.list(),
        app.vmdb.getScriptsByIndex('position'),
      ]);
    }).then(function (res) {
      var remote = {
        meta: res[0],
        data: res[1],
      };
      var local = {
        meta: _this.config.get('meta', {}),
        data: res[2],
      };
      var firstSync = !local.meta.timestamp;
      var outdated = !local.meta.timestamp || remote.meta.timestamp > local.meta.timestamp;
      _this.log('First sync:', firstSync);
      _this.log('Outdated:', outdated, '(', 'local:', local.meta.timestamp, 'remote:', remote.meta.timestamp, ')');
      var map = {};
      var getRemote = [];
      var putRemote = [];
      var delRemote = [];
      var delLocal = [];
      remote.data.forEach(function (item) {
        map[item.uri] = item;
      });
      local.data.forEach(function (item) {
        var remoteItem = map[item.uri];
        if (remoteItem) {
          if (firstSync || !item.custom.modified || remoteItem.modified > item.custom.modified) {
            getRemote.push(remoteItem);
          } else if (remoteItem.modified < item.custom.modified) {
            putRemote.push(item);
          }
          delete map[item.uri];
        } else if (firstSync || !outdated) {
          putRemote.push(item);
        } else {
          delLocal.push(item);
        }
      });
      Object.keys(map).forEach(function (uri) {
        var item = map[uri];
        if (outdated) {
          getRemote.push(item);
        } else {
          delRemote.push(item);
        }
      });
      var promises = [].concat(
        getRemote.map(function (item) {
          _this.log('Download script:', item.uri);
          return _this.get(getFilename(item.uri)).then(function (raw) {
            var data = {};
            try {
              var obj = JSON.parse(raw);
              if (obj.version === 1) {
                data.code = obj.code;
                data.more = obj.more;
              }
            } catch (e) {
              data.code = raw;
            }
            data.modified = item.modified;
            if (!options.get('syncScriptStatus') && data.more) {
              delete data.more.enabled;
            }
            return app.vmdb.parseScript(data)
            .then(function (res) {
              browser.runtime.sendMessage(res);
            });
          });
        }),
        putRemote.map(function (item) {
          _this.log('Upload script:', item.uri);
          var data = JSON.stringify({
            version: 1,
            code: item.code,
            more: {
              custom: item.custom,
              enabled: item.enabled,
              update: item.update,
            },
          });
          return _this.put(getFilename(item.uri), data)
          .then(function (data) {
            if (item.custom.modified !== data.modified) {
              item.custom.modified = data.modified;
              return app.vmdb.saveScript(item);
            }
          });
        }),
        delRemote.map(function (item) {
          _this.log('Remove remote script:', item.uri);
          return _this.remove(getFilename(item.uri));
        }),
        delLocal.map(function (item) {
          _this.log('Remove local script:', item.uri);
          return app.vmdb.removeScript(item.id);
        })
      );
      promises.push(Promise.all(promises).then(function () {
        var promises = [];
        var remoteChanged;
        if (!remote.meta.timestamp || putRemote.length || delRemote.length) {
          remoteChanged = true;
          remote.meta.timestamp = Date.now();
          promises.push(_this.put(_this.metaFile, JSON.stringify(remote.meta)));
        }
        if (!local.meta.timestamp || getRemote.length || delLocal.length || remoteChanged || outdated) {
          local.meta.timestamp = remote.meta.timestamp;
        }
        local.meta.lastSync = Date.now();
        _this.config.set('meta', local.meta);
        return Promise.all(promises);
      }));
      return Promise.all(promises.map(function (promise) {
        // ignore errors to ensure all promises are fulfilled
        return promise.then(_.noop, function (err) {
          return err || true;
        });
      }))
      .then(function (errors) {
        errors = errors.filter(function (err) {return err;});
        if (errors.length) throw errors;
      });
    })
    .then(function () {
      _this.syncState.set('idle');
    }, function (err) {
      _this.syncState.set('error');
      _this.log('Failed syncing:', _this.name);
      _this.log(err);
    });
  },
});

function register(Service) {
  var name = Service.prototype.name || Service.name;
  var service = new Service(name);
  serviceNames.push(name);
  services[name] = service;
  return service;
}
function getCurrent() {
  return syncConfig.get('current');
}
function getService(name) {
  name = name || getCurrent();
  return services[name];
}
function initialize() {
  var service = getService();
  service && service.checkSync();
}

function syncOne(service) {
  if (service.syncState.is(['ready', 'syncing'])) return;
  if (service.authState.is(['idle', 'error'])) return service.checkSync();
  if (service.authState.is('authorized')) return service.startSync();
}
function sync() {
  var service = getService();
  return service && Promise.resolve(syncOne(service)).then(autoSync);
}

function checkAuthUrl(url) {
  return serviceNames.some(function (name) {
    var service = services[name];
    return service.checkAuth && service.checkAuth(url);
  });
}

function authorize() {
  var service = getService();
  service && service.authorize();
}
function revoke() {
  var service = getService();
  service && service.revoke();
}

options.hook(function (data) {
  ('sync.current' in data) && initialize();
});

exports.utils = {
  getFilename: getFilename,
  isScriptFile: isScriptFile,
  getURI: getURI,
};
exports.initialize = initialize;
exports.sync = sync;
exports.getStates = getStates;
exports.checkAuthUrl = checkAuthUrl;
exports.BaseService = BaseService;
exports.register = register;
exports.service = getService;
exports.authorize = authorize;
exports.revoke = revoke;
