define('views/TabInstalled', function (require, _exports, module) {
  var BaseView = require('cache').BaseView;
  var app = require('app');
  var ScriptView = require('views/Script');
  var EditView = require('views/Edit');
  var Script = require('models').Script;
  module.exports = BaseView.extend({
    el: '#tab',
    name: 'main',
    templateUrl: '/options/templates/tab-installed.html',
    events: {
      'click #bNew': 'newScript',
      'click #bUpdate': 'updateAll',
      'click #bURL': 'installFromURL',
    },
    initialize: function () {
      var _this = this;
      BaseView.prototype.initialize.call(_this);
      _this.listenTo(app.scriptList, 'reset', _this.render);
      _this.listenTo(app.scriptList, 'add', _this.addOne);
      _this.listenTo(app.scriptList, 'update', _this.setBackdrop);
      _this.listenTo(app.scriptList, 'edit:open', function (model) {
        _this.closeEdit();
        _this.editView = new EditView({model: model.clone()});
        _this.$el.append(_this.editView.$el);
      });
      _this.listenTo(app.scriptList, 'edit:close', _this.closeEdit);
    },
    closeEdit: function () {
      var _this = this;
      if (_this.editView) {
        _this.editView.remove();
        _this.editView = null;
      }
    },
    _render: function () {
      this.$el.html(this.templateFn());
      this.$list = this.$('.scripts');
      this.$bd = this.$('.backdrop');
      this.$bdm = this.$('.backdrop > div');
      this.setBackdrop();
      this.addAll();
    },
    setBackdrop: function () {
      if (app.scriptList.loading) {
        this.$bd.addClass('mask').show();
        this.$bdm.html(_.i18n('msgLoading'));
      } else if (!app.scriptList.length) {
        this.$bd.removeClass('mask').show();
        this.$bdm.html(_.i18n('labelNoScripts'));
      } else {
        this.$bd.hide();
      }
    },
    addOne: function (script) {
      var view = new ScriptView({model: script});
      this.$list.append(view.$el);
    },
    addAll: function () {
      app.scriptList.forEach(this.addOne, this);
    },
    newScript: function () {
      _.sendMessage({cmd: 'NewScript'}).then(function (script) {
        app.scriptList.trigger('edit:open', new Script(script));
      });
    },
    updateAll: function () {
      _.sendMessage({cmd: 'CheckUpdateAll'});
    },
    installFromURL: function () {
      var url = prompt(_.i18n('hintInputURL'));
      if (~url.indexOf('://')) {
        chrome.tabs.create({
          url: chrome.extension.getURL('/options/index.html') + '#confirm/' + encodeURIComponent(url),
        });
      }
    },
  });
});
