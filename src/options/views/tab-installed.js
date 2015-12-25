var MainTab = BaseView.extend({
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
    _this.listenTo(scriptList, 'reset', _this.render);
    _this.listenTo(scriptList, 'add', _this.addOne);
    _this.listenTo(scriptList, 'add update', _this.setBackdrop);
    _this.listenTo(scriptList, 'edit:open', function (model) {
      _this.closeEdit();
      _this.editView = new EditView({model: model.clone()});
      _this.$el.append(_this.editView.$el);
    });
    _this.listenTo(scriptList, 'edit:close', _this.closeEdit);
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
    if (scriptList.loading) {
      this.$bd.addClass('mask').show();
      this.$bdm.html(_.i18n('msgLoading'));
    } else if (!scriptList.length) {
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
    scriptList.forEach(this.addOne, this);
  },
  newScript: function () {
    _.sendMessage({cmd: 'NewScript'}).then(function (script) {
      scriptList.trigger('edit:open', new Script(script));
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
