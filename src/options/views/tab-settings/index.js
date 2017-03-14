var _ = require('src/common');
var cache = require('src/cache');
var VmImport = require('./vm-import');
var VmExport = require('./vm-export');
var VmSync = require('./vm-sync');
var VmBlacklist = require('./vm-blacklist');
var VmCss = require('./vm-css');

module.exports = {
  template: cache.get('./index.html'),
  components: {
    VmImport: VmImport,
    VmExport: VmExport,
    VmSync: VmSync,
    VmBlacklist: VmBlacklist,
    VmCss: VmCss,
  },
  methods: {
    updateAutoUpdate: function () {
      _.sendMessage({cmd: 'AutoUpdate'});
    },
  },
};
