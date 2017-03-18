var _ = require('src/common');
var cache = require('src/cache');
var utils = require('src/options/utils');
var store = utils.store;

var SYNC_CURRENT = 'sync.current';
var syncConfig = {
  current: '',
};
_.options.hook(function (data) {
  if (SYNC_CURRENT in data) {
    syncConfig.current = data[SYNC_CURRENT] || '';
  }
});

module.exports = {
  template: cache.get('./index.html'),
  data: function () {
    return {
      syncConfig: syncConfig,
      store: store,
    };
  },
  computed: {
    syncServices: function () {
      var services = [{
        displayName: _.i18n('labelSyncDisabled'),
        name: '',
      }];
      var states = this.store.sync;
      if (states && states.length) {
        services = services.concat(states);
        this.$nextTick(function () {
          // Set `current` after options are ready
          syncConfig.current = _.options.get(SYNC_CURRENT);
        });
      }
      return services;
    },
    service: function () {
      var current = this.syncConfig.current || '';
      var service = this.syncServices.find(function (item) {
        return item.name === current;
      });
      if (!service) {
        console.warn('Invalid current service:', current);
        service = this.syncServices[0];
      }
      return service;
    },
    message: function () {
      var service = this.service;
      if (service.authState === 'initializing') return _.i18n('msgSyncInit');
      if (service.authState === 'error') return _.i18n('msgSyncInitError');
      if (service.syncState === 'error') return _.i18n('msgSyncError');
      if (service.syncState === 'ready') return _.i18n('msgSyncReady');
      if (service.syncState === 'syncing') {
        var progress = '';
        if (service.progress && service.progress.total) {
          progress = ' (' + service.progress.finished + '/' + service.progress.total + ')';
        }
        return _.i18n('msgSyncing') + progress;
      }
      if (service.lastSync) {
        var lastSync = new Date(service.lastSync).toLocaleString();
        return _.i18n('lastSync', lastSync);
      }
    },
    labelAuthorize: function () {
      var service = this.service;
      if (service.authState === 'authorizing') return _.i18n('labelSyncAuthorizing');
      if (service.authState === 'authorized') return _.i18n('labelSyncRevoke');
      return _.i18n('labelSyncAuthorize');
    },
    canAuthorize: function () {
      var service = this.service;
      return ~['unauthorized', 'error', 'authorized'].indexOf(service.authState)
      && ~['idle', 'error'].indexOf(service.syncState);
    },
    canSync: function () {
      var service = this.service;
      return this.canAuthorize && service.authState === 'authorized';
    },
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
    onSyncChange: function (e) {
      var value = e.target.value;
      _.options.set(SYNC_CURRENT, value);
    },
    onAuthorize: function () {
      var service = this.service;
      if (~['authorized'].indexOf(service.authState)) {
        // revoke
        _.sendMessage({cmd: 'SyncRevoke'});
      } else if (~['unauthorized', 'error'].indexOf(service.authState)) {
        // authorize
        _.sendMessage({cmd: 'SyncAuthorize'});
      }
    },
    onSync: function () {
      _.sendMessage({cmd: 'SyncStart'});
    },
  },
};
