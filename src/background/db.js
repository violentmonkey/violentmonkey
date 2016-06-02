define('vmdb', function (require, _exports, module) {
  var scriptUtils = require('utils/script');
  var tester = require('utils/tester');

  function VMDB() {
    var _this = this;
    _this.initialized = _this.openDB().then(_this.initPosition.bind(_this));
    _this.checkUpdate = _this.checkUpdate.bind(_this);
  }

  VMDB.prototype.openDB = function () {
    var _this = this;
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open('Violentmonkey', 1);
      request.onsuccess = function (_e) {
        _this.db = request.result;
        resolve();
      };
      request.onerror = function (e) {
        var err = e.target.error;
        console.error('IndexedDB error: ' + err.message);
        reject(err);
      };
      request.onupgradeneeded = function (e) {
        var r = e.currentTarget.result;
        // scripts: id uri custom meta enabled update code position
        var o = r.createObjectStore('scripts', {
          keyPath: 'id',
          autoIncrement: true,
        });
        o.createIndex('uri', 'uri', {unique: true});
        o.createIndex('update', 'update', {unique: false});
        // position should be unique at last
        o.createIndex('position', 'position', {unique: false});
        // require: uri code
        o = r.createObjectStore('require', {keyPath: 'uri'});
        // cache: uri data
        o = r.createObjectStore('cache', {keyPath: 'uri'});
        // values: uri values
        o = r.createObjectStore('values', {keyPath: 'uri'});
      };
    });
  };

  VMDB.prototype.initPosition = function () {
    var _this = this;
    _this.position = 0;
    var o = _this.db.transaction('scripts', 'readwrite').objectStore('scripts');
    return new Promise(function (resolve, _reject) {
      o.index('position').openCursor(null, 'prev').onsuccess = function (e) {
        var result = e.target.result;
        if (result) _this.position = result.key;
        resolve();
      };
    });
  };

  VMDB.prototype.getScript = function (id, tx) {
    tx = tx || this.db.transaction('scripts');
    var os = tx.objectStore('scripts');
    return new Promise(function (resolve, _reject) {
      os.get(id).onsuccess = function (e) {
        resolve(e.target.result);
      };
    });
  };

  VMDB.prototype.queryScript = function (id, meta, tx) {
    var _this = this;
    return id
      ? _this.getScript(id, tx)
      : new Promise(function (resolve, _reject) {
        var uri = scriptUtils.getNameURI({meta: meta});
        tx = tx || _this.db.transaction('scripts');
        tx.objectStore('scripts')
          .index('uri').get(uri).onsuccess = function (e) {
            resolve(e.target.result);
          };
      });
  };

  VMDB.prototype.getScriptData = function (id) {
    return this.getScript(id).then(function (script) {
      if (!script) return Promise.reject();
      var data = scriptUtils.getScriptInfo(script);
      data.code = script.code;
      return data;
    });
  };

  VMDB.prototype.getScriptInfos = function (ids) {
    var _this = this;
    var tx = _this.db.transaction('scripts');
    return Promise.all(ids.map(function (id) {
      return _this.getScript(id, tx);
    })).then(function (scripts) {
      return scripts.filter(function (x) {return x;})
        .map(scriptUtils.getScriptInfo);
    });
  };

  VMDB.prototype.getValues = function (uris, tx) {
    var _this = this;
    tx = tx || _this.db.transaction('values');
    var o = tx.objectStore('values');
    return Promise.all(uris.map(function (uri) {
      return new Promise(function (resolve, _reject) {
        o.get(uri).onsuccess = function (e) {
          resolve(e.target.result);
        };
      });
    })).then(function (data) {
      return data.reduce(function (result, value, i) {
        if (value) result[uris[i]] = value.values;
        return result;
      }, {});
    });
  };

  VMDB.prototype.getScriptsByURL = function (url) {
    function getScripts() {
      return _this.getScriptsByIndex('position', null, tx).then(function (scripts) {
        var data = {
          uris: [],
        };
        var require = {};
        var cache = {};
        data.scripts = scripts.filter(function (script) {
          if (tester.testURL(url, script)) {
            data.uris.push(script.uri);
            script.meta.require.forEach(function (key) {
              require[key] = 1;
            });
            for (var k in script.meta.resources)
              cache[script.meta.resources[k]] = 1;
            return true;
          }
        });
        data.require = Object.keys(require);
        data.cache = Object.keys(cache);
        return data;
      });
    }
    function getRequire(uris) {
      var o = tx.objectStore('require');
      return Promise.all(uris.map(function (uri) {
        return new Promise(function (resolve, _reject) {
          o.get(uri).onsuccess = function (e) {
            resolve(e.target.result);
          };
        });
      })).then(function (data) {
        return data.reduce(function (result, value, i) {
          if (value) result[uris[i]] = value.code;
          return result;
        }, {});
      });
    }
    var _this = this;
    var tx = _this.db.transaction(['scripts', 'require', 'values', 'cache']);
    return getScripts().then(function (data) {
      return Promise.all([
        getRequire(data.require),
        _this.getValues(data.uris, tx),
        _this.getCacheB64(data.cache, tx),
      ]).then(function (res) {
        return {
          scripts: data.scripts,
          require: res[0],
          values: res[1],
          cache: res[2],
        };
      });
    });
  };

  VMDB.prototype.getData = function () {
    function getScripts() {
      return _this.getScriptsByIndex('position', null, tx).then(function (scripts) {
        var data = {};
        var cache = {};
        data.scripts = scripts.map(function (script) {
          var icon = script.meta.icon;
          if (scriptUtils.isRemote(icon)) cache[icon] = 1;
          return scriptUtils.getScriptInfo(script);
        });
        data.cache = Object.keys(cache);
        return data;
      });
    }
    function getCache(uris) {
      return _this.getCacheB64(uris, tx).then(function (cache) {
        for (var k in cache)
          cache[k] = 'data:image/png;base64,' + cache[k];
        return cache;
      });
    }
    var _this = this;
    var tx = _this.db.transaction(['scripts', 'cache']);
    return getScripts().then(function (data) {
      return getCache(data.cache).then(function (cache) {
        return {
          scripts: data.scripts,
          cache: cache,
        };
      });
    });
  };

  VMDB.prototype.removeScript = function (id) {
    var tx = this.db.transaction('scripts', 'readwrite');
    return new Promise(function (resolve, _reject) {
      var o = tx.objectStore('scripts');
      o.delete(id).onsuccess = function () {
        resolve();
      };
    });
  };

  VMDB.prototype.moveScript = function (id, offset) {
    var tx = this.db.transaction('scripts', 'readwrite');
    var o = tx.objectStore('scripts');
    return this.getScript(id, tx).then(function (script) {
      var pos = script.position;
      var range, order;
      if (offset < 0) {
        range = IDBKeyRange.upperBound(pos, true);
        order = 'prev';
        offset = -offset;
      } else {
        range = IDBKeyRange.lowerBound(pos, true);
        order = 'next';
      }
      return new Promise(function (resolve, _reject) {
        o.index('position').openCursor(range, order).onsuccess = function (e) {
          var result = e.target.result;
          if (result) {
            offset --;
            var value = result.value;
            value.position = pos;
            pos = result.key;
            result.update(value);
            if (offset) result.continue();
            else {
              script.position = pos;
              o.put(script).onsuccess = function () {
                resolve();
              };
            }
          }
        };
      });
    });
  };

  VMDB.prototype.getCacheB64 = function (urls, tx) {
    tx = tx || this.db.transaction('cache');
    var o = tx.objectStore('cache');
    return Promise.all(urls.map(function (url) {
      return new Promise(function (resolve, _reject) {
        o.get(url).onsuccess = function (e) {
          resolve(e.target.result);
        };
      });
    })).then(function (data) {
      return data.reduce(function (map, value, i) {
        if (value) map[urls[i]] = value.data;
        return map;
      }, {});
    });
  };

  VMDB.prototype.saveCache = function (url, data, tx) {
    tx = tx || this.db.transaction('cache', 'readwrite');
    var o = tx.objectStore('cache');
    return new Promise(function (resolve, _reject) {
      o.put({uri: url, data: data}).onsuccess = function () {
        resolve();
      };
    });
  };

  VMDB.prototype.saveRequire = function (url, data, tx) {
    tx = tx || this.db.transaction('require', 'readwrite');
    var o = tx.objectStore('require');
    return new Promise(function (resolve, _reject) {
      o.put({uri: url, code: data}).onsuccess = function () {
        resolve();
      };
    });
  };

  VMDB.prototype.saveScript = function (script, tx) {
    script.enabled = script.enabled ? 1 : 0;
    script.update = script.update ? 1 : 0;
    if (!script.position) script.position = ++ this.position;
    tx = tx || this.db.transaction('scripts', 'readwrite');
    var o = tx.objectStore('scripts');
    return new Promise(function (resolve, reject) {
      var res = o.put(script);
      res.onsuccess = function (e) {
        script.id = e.target.result;
        resolve(script);
      };
      res.onerror = function () {
        reject(_.i18n('msgNamespaceConflict'));
      };
    });
  };

  VMDB.prototype.fetchCache = function () {
    var requests = {};
    return function (url, check) {
      var _this = this;
      return requests[url]
        || (requests[url] = scriptUtils.fetch(url, 'blob').then(function (res) {
          return (check ? check(res.response) : Promise.resolve()).then(function () {
            return res.response;
          });
        }).then(function (data) {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader;
            reader.onload = function (_e) {
              _this.saveCache(url, window.btoa(this.result)).then(function () {
                delete requests[url];
                resolve();
              });
            };
            reader.onerror = function (e) {
              reject(e);
            };
            reader.readAsBinaryString(data);
          });
        }));
    };
  }();

  VMDB.prototype.fetchRequire = function () {
    var requests = {};
    return function (url) {
      var _this = this;
      var promise = requests[url];
      if (!promise) {
        promise = requests[url] = scriptUtils.fetch(url)
        .then(function (res) {
          return _this.saveRequire(url, res.responseText);
        })
        .catch(function () {
          console.error('Error fetching required script: ' + url);
        })
        .then(function () {
          delete requests[url];
        });
      }
      return promise;
    };
  }();

  VMDB.prototype.setValue = function (uri, values) {
    var o = this.db.transaction('values', 'readwrite').objectStore('values');
    return new Promise(function (resolve, _reject) {
      o.put({uri: uri, values: values}).onsuccess = function () {
        resolve();
      };
    });
  };

  VMDB.prototype.updateScriptInfo = function (id, data, custom) {
    var o = this.db.transaction('scripts', 'readwrite').objectStore('scripts');
    return new Promise(function (resolve, reject) {
      o.get(id).onsuccess = function (e) {
        var script = e.target.result;
        if (!script) return reject();
        for (var k in data)
          if (k in script) script[k] = data[k];
        _.assign(script.custom, custom);
        o.put(script).onsuccess = function (_e) {
          resolve(scriptUtils.getScriptInfo(script));
        };
      };
    });
  };

  VMDB.prototype.getExportData = function (ids, withValues) {
    function getScripts(ids) {
      var o = tx.objectStore('scripts');
      return Promise.all(ids.map(function (id) {
        return new Promise(function (resolve, _reject) {
          o.get(id).onsuccess = function (e) {
            resolve(e.target.result);
          };
        });
      })).then(function (data) {
        return data.filter(function (x) {return x;});
      });
    }
    var _this = this;
    var tx = _this.db.transaction(['scripts', 'values']);
    return getScripts(ids).then(function (scripts) {
      var res = {
        scripts: scripts,
      };
      return withValues
        ? _this.getValues(scripts.map(function (script) {
          return script.uri;
        }), tx).then(function (values) {
          res.values = values;
          return res;
        }) : res;
    });
  };

  VMDB.prototype.vacuum = function () {
    function getScripts() {
      return _this.getScriptsByIndex('position', null, tx).then(function (scripts) {
        var data = {
          require: {},
          cache: {},
          values: {},
        };
        data.ids = scripts.map(function (script) {
          script.meta.require.forEach(function (uri) {data.require[uri] = 1;});
          for (var k in script.meta.resources)
            data.cache[script.meta.resources[k]] = 1;
          if (scriptUtils.isRemote(script.meta.icon))
            data.cache[script.meta.icon] = 1;
          data.values[script.uri] = 1;
          return script.id;
        });
        return data;
      });
    }
    function vacuumPosition(ids) {
      var o = tx.objectStore('scripts');
      return ids.reduce(function (res, id, i) {
        return res.then(function () {
          return new Promise(function (resolve, _reject) {
            o.get(id).onsuccess = function (e) {
              var result = e.target.result;
              result.position = i + 1;
              o.put(result).onsuccess = function () {
                resolve();
              };
            };
          });
        });
      }, Promise.resolve());
    }
    function vacuumCache(dbName, dict) {
      return new Promise(function (resolve, _reject) {
        var o = tx.objectStore(dbName);
        o.openCursor().onsuccess = function (e) {
          var result = e.target.result;
          if (result) {
            var value = result.value;
            new Promise(function (resolve, _reject) {
              if (!dict[value.uri]) {
                o.delete(value.uri).onsuccess = function () {
                  resolve();
                };
              } else {
                dict[value.uri] ++;
                resolve();
              }
            }).then(function () {
              result.continue();
            });
          } else resolve();
        };
      });
    }
    var _this = this;
    var tx = _this.db.transaction(['scripts', 'require', 'cache', 'values'], 'readwrite');
    return getScripts().then(function (data) {
      return Promise.all([
        vacuumPosition(data.ids),
        vacuumCache('require', data.require),
        vacuumCache('cache', data.cache),
        vacuumCache('values', data.values),
      ]).then(function () {
        return {
          require: data.require,
          cache: data.cache,
        };
      });
    }).then(function (data) {
      return Promise.all([
        Object.keys(data.require).map(function (k) {
          return data.require[k] === 1 && _this.fetchRequire(k);
        }),
        Object.keys(data.cache).map(function (k) {
          return data.cache[k] === 1 && _this.fetchCache(k);
        }),
      ]);
    });
  };

  VMDB.prototype.getScriptsByIndex = function (index, value, tx) {
    tx = tx || this.db.transaction('scripts');
    return new Promise(function (resolve, _reject) {
      var o = tx.objectStore('scripts');
      var list = [];
      o.index(index).openCursor(value).onsuccess = function (e) {
        var result = e.target.result;
        if (result) {
          list.push(result.value);
          result.continue();
        } else resolve(list);
      };
    });
  };

  VMDB.prototype.parseScript = function (data) {
    var res = {
      cmd: 'update',
      data: {
        message: data.message == null ? _.i18n('msgUpdated') : data.message || '',
      },
    };
    var meta = scriptUtils.parseMeta(data.code);
    var _this = this;
    var tx = _this.db.transaction(['scripts', 'require'], 'readwrite');
    // @require
    meta.require.forEach(function (url) {
      var cache = data.require && data.require[url];
      cache ? _this.saveRequire(url, cache, tx) : _this.fetchRequire(url);
    });
    // @resource
    Object.keys(meta.resources).forEach(function (k) {
      var url = meta.resources[k];
      var cache = data.resources && data.resources[url];
      cache ? _this.saveCache(url, cache) : _this.fetchCache(url);
    });
    // @icon
    if (scriptUtils.isRemote(meta.icon))
      _this.fetchCache(meta.icon, function (blob) {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(blob);
          var image = new Image;
          var free = function () {
            URL.revokeObjectURL(url);
          };
          image.onload = function () {
            free();
            resolve(blob);
          };
          image.onerror = function () {
            free();
            reject();
          };
          image.src = url;
        });
      });
      return _this.queryScript(data.id, meta, tx).then(function (script) {
        if (script) {
          if (data.isNew) throw _.i18n('msgNamespaceConflict');
        } else {
          script = scriptUtils.newScript();
          res.cmd = 'add';
          res.data.message = _.i18n('msgInstalled');
        }
        if (data.more) for (var k in data.more)
          if (k in script) script[k] = data.more[k];
        script.meta = meta;
        script.code = data.code;
        script.uri = scriptUtils.getNameURI(script);
        // use referer page as default homepage
        if (!meta.homepageURL && !script.custom.homepageURL && scriptUtils.isRemote(data.from))
          script.custom.homepageURL = data.from;
        if (scriptUtils.isRemote(data.url))
          script.custom.lastInstallURL = data.url;
        script.custom.modified = data.modified || Date.now();
        return _this.saveScript(script, tx);
      }).then(function (script) {
        _.assign(res.data, scriptUtils.getScriptInfo(script));
        return res;
      });
  };

  VMDB.prototype.checkUpdate = function () {
    function check(script) {
      var res = {
        cmd: 'update',
        data: {
          id: script.id,
          checking: true,
        },
      };
      var downloadURL = script.custom.downloadURL || script.meta.downloadURL || script.custom.lastInstallURL;
      var updateURL = script.custom.updateURL || script.meta.updateURL || downloadURL;
      var okHandler = function (xhr) {
        var meta = scriptUtils.parseMeta(xhr.responseText);
        if (scriptUtils.compareVersion(script.meta.version, meta.version) < 0)
          return Promise.resolve();
        res.data.checking = false;
        res.data.message = _.i18n('msgNoUpdate');
        _.messenger.post(res);
        return Promise.reject();
      };
      var errHandler = function (_xhr) {
        res.data.checking = false;
        res.data.message = _.i18n('msgErrorFetchingUpdateInfo');
        _.messenger.post(res);
        return Promise.reject();
      };
      var update = function () {
        if (!downloadURL) {
          res.data.message = '<span class="new">' + _.i18n('msgNewVersion') + '</span>';
          _.messenger.post(res);
          return Promise.reject();
        }
        res.data.message = _.i18n('msgUpdating');
        _.messenger.post(res);
        return scriptUtils.fetch(downloadURL).then(function (xhr) {
          return xhr.responseText;
        }, function (_xhr) {
          res.data.checking = false;
          res.data.message = _.i18n('msgErrorFetchingScript');
          _.messenger.post(res);
          return Promise.reject();
        });
      };
      if (!updateURL) return Promise.reject();
      res.data.message = _.i18n('msgCheckingForUpdate');
      _.messenger.post(res);
      return scriptUtils.fetch(updateURL, null, {
        Accept: 'text/x-userscript-meta',
      }).then(okHandler, errHandler).then(update);
    }

    var processes = {};
    return function (script) {
      var _this = this;
      var promise = processes[script.id];
      if (!promise)
        promise = processes[script.id] = check(script).then(function (code) {
          delete processes[script.id];
          return _this.parseScript({
            id: script.id,
            code: code,
          }).then(function (res) {
            res.data.checking = false;
            _.messenger.post(res);
          });
        }, function () {
          delete processes[script.id];
          //return Promise.reject();
        });
        return promise;
    };
  }();

  module.exports = VMDB;
});
