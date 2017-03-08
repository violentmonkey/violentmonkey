var _ = require('src/common');
var cache = require('src/cache');
var utils = require('src/options/utils');
var store = utils.store;
var SyncService = require('./service');

module.exports = {
  template: cache.get('./index.html'),
  components: {
    SyncService: SyncService,
  },
  data: function () {
    return {
      store: store,
    };
  },
  methods: {
    onEnableService: function (name) {
      store.sync.forEach(function (service) {
        if (service.name !== name) {
          var key = service.name + '.enabled';
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
