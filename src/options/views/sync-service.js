var cache = require('../../cache');
var _ = require('../../common');
var utils = require('../utils');
var events = utils.events;

module.exports = {
  props: ['service'],
  template: cache.get('./sync-service.html'),
  computed: {
    labelText: function () {
      var service = this.service;
      return _.i18n('labelSyncTo', service.displayName || service.name);
    },
    labelAuthenticate: function () {
      return {
        authorized: _.i18n('buttonAuthorized'),
        authorizing: _.i18n('buttonAuthorizing'),
      }[this.service.authState] || _.i18n('buttonAuthorize');
    },
    disableSync: function () {
      var service = this.service;
      return !!(
        ['authorized', 'error'].indexOf(service.authState) < 0 ||
        ~['ready', 'syncing'].indexOf(service.syncState)
      );
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
  },
  methods: {
    retry: function () {
      _.sendMessage({
        cmd: 'SyncStart',
        data: this.service.name,
      });
    },
    authenticate: function () {
      _.sendMessage({cmd: 'Authenticate', data: this.service.name});
    },
    update: function (e) {
      e.target.checked && events.$emit('EnableService', this.service.name);
    },
  },
};
