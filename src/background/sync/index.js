/* eslint-disable no-console */
define('sync', function (require, _exports, module) {
  var events = require('events');
  var app = require('app');
  var tabs = require('utils/tabs');

  var services = [];
  var servicesReady = [];
  var inited;
  var current = Promise.resolve();
  var autoSync = _.debounce(function () {
    sync();
  }, 60 * 60 * 1000);

  function ServiceConfig(name) {
    this.prefix = name;
    this.load();
  }
  ServiceConfig.prototype.get = function (key, def) {
    var val = this.data[key];
    if (val == null) val = def;
    return val;
  };
  ServiceConfig.prototype.set = function (key, val) {
    if (typeof key === 'object') {
      if (arguments.length === 1) {
        _.assign(this.data, key);
        this.dump();
      }
    } else {
      // val may be an object, so equal test does not work
      this.data[key] = val;
      this.dump();
    }
  };
  ServiceConfig.prototype.clear = function () {
    this.data = {};
    this.dump();
  };
  ServiceConfig.prototype.capitalize = function (string) {
    return string[0].toUpperCase() + string.slice(1);
  };
  ServiceConfig.prototype.getOption = function (key, def) {
    key = this.capitalize(key);
    return _.options.get(this.prefix + key, def);
  };
  ServiceConfig.prototype.setOption = function (key, val) {
    key = this.capitalize(key);
    return _.options.set(this.prefix + key, val);
  };
  ServiceConfig.prototype.load = function () {
    this.data = _.options.get(this.prefix, {});
  };
  ServiceConfig.prototype.dump = function () {
    _.options.set(this.prefix, this.data);
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
        if (!_.isArray(states)) states = [states];
        return _.includes(states, state);
      },
    };
  }
  function service(name, Service) {
    var service;
    if (typeof name === 'function') {
      Service = name;
      name = Service.prototype.name || Service.name;
    }
    if (Service) {
      // initialize
      service = new Service(name);
      setTimeout(function () {
        services.push(service);
        inited && service.checkSync();
      });
    } else {
      // get existent instance
      for (var i = services.length; i --; ) {
        if (services[i].name === name) break;
      }
      // i may be -1 if not found
      service = services[i];
    }
    return service;
  }
  function getStates() {
    return services.map(function (service) {
      return {
        name: service.name,
        displayName: service.displayName,
        authState: service.authState.get(),
        syncState: service.syncState.get(),
        lastSync: service.config.get('meta', {}).lastSync,
      };
    });
  }
  function syncOne(service) {
    if (service.syncState.is(['ready', 'syncing'])) return;
    if (service.authState.is(['idle', 'error'])) return service.checkSync();
    if (service.authState.is('authorized')) return service.startSync();
  }
  function syncAll() {
    return Promise.all(servicesReady.filter(function (service) {
      return service.config.getOption('enabled') && !service.syncState.is(['ready', 'syncing']);
    }).map(function (service) {
      return service.startSync();
    }));
  }
  function sync(service) {
    return (service ? Promise.resolve(syncOne(service)) : syncAll())
    .then(autoSync);
  }
  function init() {
    inited = true;
    services.forEach(function (service) {
      service.checkSync();
    });
    sync();
  }
  function getFilename(uri) {
    return 'vm-' + encodeURIComponent(uri);
  }
  function getURI(name) {
    return decodeURIComponent(name.slice(3));
  }
  function isScriptFile(name) {
    return /^vm-/.test(name);
  }

  function serviceFactory(base, options) {
    var Service = function () {
      this.initialize.apply(this, arguments);
    };
    Service.prototype = _.assign(Object.create(base), options);
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
      if (name) _this.name = name;
      _this.config = new ServiceConfig(_this.name);
      _this.authState = serviceState([
        'idle',
        'initializing',
        'authorizing',  // in case some services require asynchronous requests to get access_tokens
        'authorized',
        'unauthorized',
        'error',
      ], null, _this.onStateChange),
      _this.syncState = serviceState([
        'idle',
        'ready',
        'syncing',
        'error',
      ], null, _this.onStateChange),
      _this.initHeaders();
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
      _.messenger.post({
        cmd: 'sync',
        data: getStates(),
      });
    },
    syncFactory: function () {
      var _this = this;
      var promise, debouncedResolve;
      function shouldSync() {
        return _this.authState.is('authorized') && _this.config.getOption('enabled');
      }
      function init() {
        if (!shouldSync()) return Promise.resolve();
        console.log('Ready to sync:', _this.displayName);
        _this.syncState.set('ready');
        promise = current = current.then(function () {
          return new Promise(function (resolve, _reject) {
            debouncedResolve = _.debounce(resolve, 10 * 1000);
            debouncedResolve();
          });
        }).then(function () {
          if (shouldSync()) {
            return _this.sync();
          }
          _this.syncState.set('idle');
        }).then(function () {
          promise = debouncedResolve = null;
        });
      }
      return function () {
        if (!promise) init();
        debouncedResolve && debouncedResolve();
        return promise;
      };
    },
    prepare: function () {
      var _this = this;
      _this.authState.set('initializing');
      var token = _this.token = _this.config.get('token');
      _this.initHeaders();
      return (token ? Promise.resolve(_this.user()) : Promise.reject())
      .then(function () {
        _this.authState.set('authorized');
      }, function (err) {
        if (err) {
          if (err.status === 401) {
            _this.config.clear();
            _this.authState.set('unauthorized');
          } else {
            console.error(err);
            _this.authState.set('error');
          }
          _this.syncState.set('idle');
          // _this.config.setOption('enabled', false);
        } else {
          _this.authState.set('unauthorized');
        }
        throw err;
      });
    },
    checkSync: function () {
      var _this = this;
      return _this.prepare()
      .then(function () {
        servicesReady.push(_this);
        return _this.startSync();
      }, function () {
        var i = servicesReady.indexOf(_this);
        if (~i) servicesReady.splice(i, 1);
      });
    },
    user: function () {},
    getMeta: function () {
      var _this = this;
      return _this.get(_this.metaFile)
      .then(function (data) {
        return JSON.parse(data);
      });
    },
    initHeaders: function () {
      var headers = this.headers = {};
      var token = this.token;
      if (token) headers.Authorization = 'Bearer ' + token;
    },
    request: function (options) {
      var _this = this;
      var lastFetch;
      if (options.noDelay) {
        lastFetch = Promise.resolve();
      } else {
        lastFetch = _this.lastFetch;
        _this.lastFetch = lastFetch.then(function () {
          return _this.delay();
        });
      }
      return lastFetch.then(function () {
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest;
          var prefix = options.prefix;
          if (prefix == null) prefix = _this.urlPrefix;
          xhr.open(options.method || 'GET', prefix + options.url, true);
          var headers = _.assign({}, _this.headers, options.headers);
          if (options.body && typeof options.body === 'object') {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
          }
          for (var k in headers) {
            var v = headers[k];
            v && xhr.setRequestHeader(k, v);
          }
          xhr.timeout = 10 * 1000;
          xhr.onload = function () {
            if (!this.status || this.status > 300)
              reject(this);
            else
              resolve(this.responseText);
          };
          xhr.onerror = function () {
            if (this.status === 503) {
              // TODO Too Many Requests
            }
            requestError();
          };
          xhr.ontimeout = function () {
            requestError('Timed out.');
          };
          xhr.send(options.body);

          function requestError(reason) {
            reject({
              url: options.url,
              status: xhr.status,
              reason: reason || xhr.responseText,
            });
          }
        });
      });
    },
    sync: function () {
      var _this = this;
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
        console.log('First sync:', firstSync);
        console.log('Outdated:', outdated, '(', 'local:', local.meta.timestamp, 'remote:', remote.meta.timestamp, ')');
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
        for (var uri in map) {
          var item = map[uri];
          if (outdated) {
            getRemote.push(item);
          } else {
            delRemote.push(item);
          }
        }
        var promises = [].concat(
          getRemote.map(function (item) {
            console.log('Download script:', item.uri);
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
              return app.vmdb.parseScript(data)
              .then(function (res) {
                _.messenger.post(res);
              });
            });
          }),
          putRemote.map(function (item) {
            console.log('Upload script:', item.uri);
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
            console.log('Remove remote script:', item.uri);
            return _this.remove(getFilename(item.uri));
          }),
          delLocal.map(function (item) {
            console.log('Remove local script:', item.uri);
            return app.vmdb.removeScript(item.id)
            .then(function () {
              _.messenger.post({
                cmd: 'del',
                data: item.id,
              });
            });
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
          return promise.then(function () {}, function (err) {
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
        console.log('Failed syncing:', _this.name);
        console.log(err);
      });
    },
  });

  tabs.update(function (tab) {
    tab.url && services.some(function (service) {
      return service.checkAuthenticate && service.checkAuthenticate(tab.url);
    }) && tabs.remove(tab.id);
  });

  module.exports = {
    init: init,
    sync: sync,
    service: service,
    states: getStates,
    utils: {
      getFilename: getFilename,
      isScriptFile: isScriptFile,
      getURI: getURI,
    },
    BaseService: BaseService,
  };
});
