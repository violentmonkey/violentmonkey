var MetaView = BaseView.extend({
  className: 'button-panel',
  templateUrl: '/options/templates/edit-meta.html',
  events: {
    'change [data-id]': 'onChange',
    'mousedown': 'onMousedown',
  },
  _render: function () {
    var model = this.model;
    var it = model.toJSON();
    it.__name = model.meta.name;
    it.__homepageURL = model.meta.homepageURL;
    it.__updateURL = model.meta.updateURL || _.i18n('hintUseDownloadURL');
    it.__downloadURL = model.meta.downloadURL || it.lastInstallURL;
    this.$el.html(this.templateFn(it));
  },
  onChange: function (e) {
    e.stopPropagation();
    var res = this.getValue(e.target);
    this.model.set(res.key, res.value);
  },
  onMousedown: function (e) {
    e.stopPropagation();
  },
});
