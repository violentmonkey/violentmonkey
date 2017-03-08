var _ = require('src/common');
var cache = require('src/cache');
var Message = require('src/options/views/message');

module.exports = {
  template: cache.get('./index.html'),
  data: function () {
    return {
      vacuuming: false,
      labelVacuum: _.i18n('buttonVacuum'),
    };
  },
  methods: {
    importFile: function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.onchange = function () {
        input.files && input.files.length && importData(input.files[0]);
      };
      input.click();
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
  },
};

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

function importData(file) {
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
