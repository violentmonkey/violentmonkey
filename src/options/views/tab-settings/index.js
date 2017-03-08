var _ = require('src/common');
var cache = require('src/cache');
var VmImport = require('./vm-import');
var VmExport = require('./vm-export');
var VmSync = require('./vm-sync');

module.exports = {
  template: cache.get('./index.html'),
  components: {
    VmImport: VmImport,
    VmExport: VmExport,
    VmSync: VmSync,
  },
  methods: {
    updateAutoUpdate: function () {
      _.sendMessage({cmd: 'AutoUpdate'});
    },
  },
};
