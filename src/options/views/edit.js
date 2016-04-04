var EditView = BaseView.extend({
  className: 'frame edit',
  templateUrl: '/options/templates/edit.html',
  events: {
    'click .button-toggle': 'toggleMeta',
    'change [data-id]': 'updateCheckbox',
    'click #editorSave': 'save',
    'click #editorClose': 'close',
    'click #editorSaveClose': 'saveClose',
  },
  initialize: function () {
    var _this = this;
    BaseView.prototype.initialize.call(_this);
    _this.metaModel = new Meta(_this.model.toJSON(), {parse: true});
    _this.listenTo(_this.metaModel, 'change', function (model) {
      _this.model.set('custom', model.toJSON());
    });
    _this.listenTo(_this.model, 'change', function (model) {
      _this.updateStatus(true);
    });
    _.bindAll(_this, 'save', 'close', 'hideMeta');
  },
  _render: function () {
    var _this = this;
    var it = _this.model.toJSON();
    _this.$el.html(_this.templateFn(it));
    _this.$toggler = _this.$('.button-toggle');
    var gotScript = it.id ? _.sendMessage({
      cmd: 'GetScript',
      data: it.id,
    }) : Promise.resolve(it);
    _this.loadedEditor = _.initEditor({
      container: _this.$('.editor-code')[0],
      onsave: _this.save,
      onexit: _this.close,
      onchange: function (e) {
        _this.model.set('code', _this.editor.getValue());
      },
    });
    Promise.all([
      gotScript,
      _this.loadedEditor,
    ]).then(function (res) {
      var script = res[0];
      var editor = _this.editor = res[1];
      editor.setValueAndFocus(script.code);
      editor.clearHistory();
      _this.updateStatus(false);
    });
  },
  updateStatus: function (changed) {
    this.changed = changed;
    this.$('#editorSave').prop('disabled', !changed);
    this.$('#editorSaveClose').prop('disabled', !changed);
  },
  save: function () {
    var _this = this;
    var data = _this.model.toJSON();
    return _.sendMessage({
      cmd: 'ParseScript',
      data: {
        id: data.id,
        code: data.code,
        message: '',
        more: {
          custom: data.custom,
          update: data.update,
        }
      }
    }).then(function () {
      _this.updateStatus(false);
    }, function (err) {
      _.showMessage({
        data: err,
      });
    });
  },
  close: function () {
    if (!this.changed || confirm(_.i18n('confirmNotSaved')))
      scriptList.trigger('edit:close');
  },
  saveClose: function () {
    this.save().then(this.close);
  },
  hideMeta: function () {
    if (!this.metaView) return;
    this.$toggler.removeClass('active');
    this.metaView.remove();
    this.metaView = null;
  },
  toggleMeta: function (e) {
    if (this.metaView) {
      this.hideMeta();
    } else {
      this.$toggler.addClass('active');
      this.metaView = new MetaView({model: this.metaModel});
      this.metaView.$el.insertAfter(e.target);
      $(document).one('mousedown', this.hideMeta);
    }
  },
  updateCheckbox: function (e) {
    var res = this.getValue(e.target);
    this.model.set(res.key, res.value);
  },
});
