var _ = require('src/common');
var cache = require('src/cache');
var utils = require('src/options/utils');
var store = utils.store;

module.exports = {
  template: cache.get('./index.html'),
  data: function () {
    return {
      store: store,
      selectedIds: [],
      exporting: false,
    };
  },
  watch: {
    'store.scripts': function () {
      this.updateSelection(true);
    },
  },
  created: function () {
    this.updateSelection(true);
  },
  methods: {
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
    exportData: function () {
      var _this = this;
      _this.exporting = true;
      Promise.resolve(exportData(_this.selectedIds))
      .catch(function (err) {
        console.error(err);
      })
      .then(function () {
        _this.exporting = false;
      });
    },
  },
};

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
  })
  .then(function (blob) {
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

function exportData(selectedIds) {
  if (!selectedIds.length) return;
  var withValues = _.options.get('exportValues');
  return _.sendMessage({
    cmd: 'ExportZip',
    data: {
      values: withValues,
      ids: selectedIds,
    }
  })
  .then(function (data) {
    var names = {};
    var vm = {
      scripts: {},
      settings: _.options.get(),
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
  })
  .then(function (files) {
    return files.reduce(function (result, file) {
      return result.then(function (writer) {
        return addFile(writer, file);
      });
    }, getWriter());
  })
  .then(download);
}
