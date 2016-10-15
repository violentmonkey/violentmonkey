function importData(file) {
  function forEach(obj, cb) {
    obj && Object.keys(obj).forEach(function (key) {
      var value = obj[key];
      cb(value, key);
    });
  }
  function getVMConfig(text) {
    var vm;
    try {
      vm = JSON.parse(text);
    } catch (e) {
      console.warn('Error parsing ViolentMonkey configuration.');
    }
    vm = vm || {};
    forEach(vm.values, function (value, key) {
      value && _.sendMessage({
        cmd: 'SetValue',
        data: {
          uri: key,
          values: value,
        }
      });
    });
    forEach(vm.settings, function (value, key) {
      _.options.set(key, value);
    });
    return vm;
  }
  function getVMFile(entry, vm) {
    if (!entry.filename.endsWith('.user.js')) return;
    vm = vm || {};
    return new Promise(function (resolve, _reject) {
      var writer = new zip.TextWriter;
      entry.getData(writer, function (text) {
        var script = {code: text};
        if (vm.scripts) {
          var more = vm.scripts[entry.filename.slice(0, -8)];
          if (more) {
            delete more.id;
            script.more = more;
          }
        }
        _.sendMessage({
          cmd: 'ParseScript',
          data: script,
        }).then(function () {
          resolve(true);
        });
      });
    });
  }
  function getVMFiles(entries) {
    var i = entries.findIndex(function (entry) {
      return entry.filename === 'ViolentMonkey';
    });
    if (~i) return new Promise(function (resolve, _reject) {
      var writer = new zip.TextWriter;
      entries[i].getData(writer, function (text) {
        entries.splice(i, 1);
        resolve({
          vm: getVMConfig(text),
          entries: entries,
        });
      });
    });
    return {
      entries: entries,
    };
  }
  function readZip(file) {
    return new Promise(function (resolve, reject) {
      zip.createReader(new zip.BlobReader(file), function (res) {
        res.getEntries(function (entries) {
          resolve(entries);
        });
      }, function (err) {reject(err);});
    });
  }
  readZip(file).then(getVMFiles).then(function (data) {
    var vm = data.vm;
    var entries = data.entries;
    return Promise.all(entries.map(function (entry) {
      return getVMFile(entry, vm);
    })).then(function (res) {
      return res.filter(function (item) {return item;}).length;
    });
  }).then(function (count) {
    Message.open({text: _.i18n('msgImported', [count])});
  });
}
function exportData(selectedIds) {
  function getWriter() {
    return new Promise(function (resolve, _reject) {
      zip.createWriter(new zip.BlobWriter, function (writer) {
        resolve(writer);
      });
    });
  }
  function addFile(writer, file) {
    return new Promise(function (resolve, _reject) {
      writer.add(file.name, new zip.TextReader(file.content), function () {
        resolve(writer);
      });
    });
  }
  function download(writer) {
    return new Promise(function (resolve, _reject) {
      writer.close(function (blob) {
        resolve(blob);
      });
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'scripts.zip';
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      });
    });
  }
  if (!selectedIds.length) return;
  var withValues = _.options.get('exportValues');
  _.sendMessage({
    cmd: 'ExportZip',
    data: {
      values: withValues,
      ids: selectedIds,
    }
  }).then(function (data) {
    var names = {};
    var vm = {
      scripts: {},
      settings: _.options.getAll(),
    };
    if (withValues) vm.values = {};
    var files = data.scripts.map(function (script) {
      var name = script.custom.name || script.meta.name || 'Noname';
      if (names[name]) name += '_' + (++ names[name]);
      else names[name] = 1;
      vm.scripts[name] = ['id', 'custom', 'enabled', 'update'].reduce(function (res, key) {
        res[key] = script[key];
        return res;
      }, {});
      if (withValues) {
        var values = data.values[script.uri];
        if (values) vm.values[script.uri] = values;
      }
      return {
        name: name + '.user.js',
        content: script.code,
      };
    });
    files.push({
      name: 'ViolentMonkey',
      content: JSON.stringify(vm),
    });
    return files;
  }).then(function (files) {
    return files.reduce(function (result, file) {
      return result.then(function (writer) {
        return addFile(writer, file);
      });
    }, getWriter()).then(download);
  });
}

var Message = require('./message');
var SyncService = require('./sync-service');
var utils = require('../utils');
var store = utils.store;
var events = utils.events;
var cache = require('../../cache');
var _ = require('../../common');

module.exports = {
  template: cache.get('./tab-settings.html'),
  components: {
    SyncService: SyncService,
  },
  data: function () {
    return {
      store: store,
      selectedIds: [],
      exporting: false,
      vacuuming: false,
      labelVacuum: _.i18n('buttonVacuum'),
    };
  },
  watch: {
    'store.scripts': function () {
      this.updateSelection(true);
    },
  },
  created: function () {
    this.updateSelection(true);
    events.$on('EnableService', this.onEnableService);
  },
  beforeDestroy: function () {
    events.$off('EnableService', this.onEnableService);
  },
  methods: {
    updateAutoUpdate: function () {
      _.sendMessage({cmd: 'AutoUpdate'});
    },
    updateSelection: function (select) {
      var _this = this;
      if (!store.scripts.length) return;
      if (select == null) select = _this.selectedIds.length < store.scripts.length;
      if (select) {
        _this.selectedIds = store.scripts.map(function (script) {
          return script.id;
        });
      } else {
        _this.selectedIds = [];
      }
    },
    importFile: function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.onchange = function () {
        input.files && input.files.length && importData(input.files[0]);
      };
      input.click();
    },
    exportData: function () {
      var _this = this;
      _this.exporting = true;
      exportData(_this.selectedIds)
      .catch(_.noop)
      .then(function () {
        _this.exporting = false;
      });
    },
    vacuum: function () {
      var _this = this;
      _this.vacuuming = true;
      _this.labelVacuum = _.i18n('buttonVacuuming');
      _.sendMessage({cmd: 'Vacuum'})
      .then(function () {
        _this.vacuuming = false;
        _this.labelVacuum = _.i18n('buttonVacuumed');
      });
    },
    onEnableService: function (name) {
      store.sync.forEach(function (service) {
        if (service.name !== name) {
          var key = service.name + 'Enabled';
          var enabled = _.options.get(key);
          if (enabled) {
            _.options.set(key, false);
          }
        }
      });
      _.sendMessage({cmd: 'SyncStart'});
    },
  },
};
