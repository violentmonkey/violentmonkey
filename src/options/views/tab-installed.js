define('views/TabInstalled', function (require, _exports, module) {
  var BaseView = require('cache').BaseView;
  var app = require('app');
  var ScriptView = require('views/Script');
  var EditView = require('views/Edit');
  var Script = require('models').Script;
  module.exports = BaseView.extend({
    name: 'main',
    className: 'content no-pad',
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
    remove: function () {
      var _this = this;
      _this.clear();
      BaseView.prototype.remove.call(_this);
    },
    closeEdit: function () {
      var _this = this;
      if (_this.editView) {
        _this.editView.remove();
        _this.editView = null;
      }
    },
    _render: function () {
      var _this = this;
      _this.clear();
      _this.$el.html(_this.templateFn());
      _this.$list = _this.$('.scripts');
      _this.$bd = _this.$('.backdrop');
      _this.$bdm = _this.$('.backdrop > div');
      _this.setBackdrop();
      _this.addAll();
    },
    setBackdrop: function () {
      var _this = this;
      if (app.scriptList.loading) {
        _this.$bd.addClass('mask').show();
        _this.$bdm.html(_.i18n('msgLoading'));
      } else if (!app.scriptList.length) {
        _this.$bd.removeClass('mask').show();
        _this.$bdm.html(_.i18n('labelNoScripts'));
      } else {
        _this.$bd.hide();
      }
    },
    addOne: function (script) {
      var _this = this;
      var view = new ScriptView({model: script});
      _this.childViews.push(view);
      _this.$list.append(view.$el);
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
