var SyncServiceView = BaseView.extend({
  className: 'line',
  templateUrl: '/options/templates/sync-service.html',
  events: {
    'click .sync-start': 'retry',
  },
  _render: function () {
    var it = this.model.toJSON();
    it.enabled = _.options.get(it.name + 'Enabled');
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
