var sync = function () {
  var METAFILE = 'Violentmonkey';
  var services = [dropbox];
  var servicesReady = [];
  var queue = [];
  var syncing;
  var timer;

  return {
    init: init,
    start: start,
  };

  function start(service) {
    if (service) queue.push(service);
    else if (!syncing && queue.length < servicesReady.length) queue = servicesReady.slice();
    if (syncing) return;
    debouncedSync();
  }
  function debouncedSync() {
    console.log('Ready to sync');
    timer && clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      console.log('Start to sync');
      sync();
    }, 10000);
  }
  function stopSync() {
    console.log('Sync ended');
    syncing = false;
  }
  function sync() {
    var service = queue.shift();
    if (!service) return stopSync();
    syncing = true;
    syncOne(service).then(sync, stopSync);
  }
  function init() {
    services.forEach(function (service) {
      service.on('init', function () {
        servicesReady.push(service);
        start(service);
      });
      service.init();
    });
  }
  function getFilename(uri) {
    return encodeURIComponent(uri) + '.user.js';
  }
  function syncOne(service) {
    if (!service.inst) return;
    return Promise.all([
      service.inst.list(),
      service.inst.get(METAFILE)
      .then(function (data) {
        return JSON.parse(data);
      }, function (res) {
        if (res.status === 404) {
          return {};
        }
        throw res;
      }),
      vmdb.getScriptsByIndex('position'),
    ]).then(function (res) {
      var remote = {
        data: res[0],
        meta: res[1],
      };
      var local = {
        data: res[2],
        meta: service.meta,
      };
      var firstSync = !local.meta.timestamp;
      var outdated = !local.meta.timestamp || remote.meta.timestamp > local.meta.timestamp;
      console.log('First sync:', firstSync);
      console.log('Outdated:', outdated);
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
          if (firstSync || remoteItem.modified <= item.custom.modified) {
            // up to date
            delete map[item.uri];
          }
        } else if (firstSync || !outdated) {
          putRemote.push(item);
        } else {
          delLocal.push(item);
        }
        return map;
      });
      for (var uri in map) {
        var item = map[uri];
        if (firstSync || outdated) {
          getRemote.push(item);
        } else {
          delRemote.push(item);
        }
      }
      var promises = [].concat(
        getRemote.map(function (item) {
          console.log('Download script:', item.uri);
          return service.inst.get(getFilename(item.uri)).then(function (code) {
            return vmdb.parseScript({
              code: code,
              modified: item.modified,
            });
          });
        }),
        putRemote.map(function (item) {
          console.log('Upload script:', item.uri);
          return service.inst.put(getFilename(item.uri), item.code).then(function (data) {
            if (item.custom.modified !== data.modified) {
              item.custom.modified = data.modified;
              return vmdb.saveScript(item);
            }
          });
        }),
        delRemote.map(function (item) {
          console.log('Remove remote script:', item.uri);
          return service.inst.remove(getFilename(item.uri));
        }),
        delLocal.map(function (item) {
          console.log('Remove local script:', item.uri);
          return vmdb.removeScript(item.id);
        })
      );
      return Promise.all(promises).then(function () {
        var promises = [];
        if (!remote.meta.timestamp || putRemote.length || delRemote.length) {
          remote.meta.timestamp = Date.now();
          promises.push(service.inst.put(METAFILE, JSON.stringify(remote.meta)));
        }
        if (!local.meta.timestamp || getRemote.length || delLocal.length) {
          local.meta.timestamp = remote.meta.timestamp;
          service.dump();
        }
        return Promise.all(promises);
      });
    }).catch(err => console.log(err));
  }
}();
