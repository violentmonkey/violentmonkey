var SyncServiceView = BaseView.extend({
  templateUrl: '/options/templates/sync-service.html',
  events: {
    'click .sync-start': 'retry',
  },
  _render: function () {
    var it = this.model.toJSON();
    it.initializing = it.authState === 'initializing';
    it.authorized = it.authState === 'authorized';
    it.unauthorized = it.authState === 'unauthorized';
    it.error = it.syncState === 'error';
    it.syncing = it.syncState === 'syncing';
    it.lastSync = it.timestamp && new Date(it.timestamp).toLocaleString();
    this.$el.html(this.templateFn(it));
  },
  retry: function () {
    _.sendMessage({
      cmd: 'SyncStart',
      data: this.model.get('name'),
    });
  },
});
