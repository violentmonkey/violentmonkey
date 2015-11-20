var BaseView = Backbone.View.extend({
  initialize: function () {
    var _this = this;
    var gotTemplate;
    if (_this.templateUrl)
      gotTemplate = _.cache.get(_this.templateUrl)
      .then(function (fn) {
        _this.templateFn = fn;
      });
    var render = _this.render.bind(_this);
    var initI18n = _this.initI18n.bind(_this);
    _this.render = function () {
      gotTemplate
        ? gotTemplate.then(render).then(initI18n)
        : render();
      return _this;
    };
    _this.render();
  },
  initI18n: function () {
		_.forEach(this.$('[data-i18n]'), function (node) {
			node.innerHTML = _.i18n(node.dataset.i18n);
		});
  },
});

var ScriptView = BaseView.extend({
  templateUrl: 'templates/script.html',
  render: function () {
    this.$el.html(this.templateFn(this.model.toJSON()));
    return this;
  },
});

var MainTab = BaseView.extend({
  el: '#tab',
  name: 'main',
  templateUrl: 'templates/tab-installed.html',
  initialize: function () {
    BaseView.prototype.initialize.call(this);
    this.listenTo(scriptList, 'reset', this.render);
    this.listenTo(scriptList, 'add', this.addOne);
    this.listenTo(scriptList, 'add', this.setBackdrop);
  },
  render: function () {
    this.$el.html(this.templateFn());
    this.$list = this.$('.script-list');
    this.$bd = this.$('.backdrop');
    this.$bdm = this.$('.backdrop > div');
    this.setBackdrop();
    this.addAll();
    return this;
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
});

var ExportList = BaseView.extend({
  el: '.export-list',
  templateUrl: 'templates/option.html',
  render: function () {
    var _this = this;
    _this.$el.html(scriptList.map(function (script) {
      return _this.templateFn(script.toJSON());
    }).join(''));
    return _this;
  },
  getSelected: function () {
    var selected = [];
    _this.$('option').each(function (i, option) {
      if (option.selected) selected.push(scriptList[i]);
    });
    return selected;
  },
  toggleAll: function () {
    var options = this.$('option');
    var select = _.some(options, function (option) {
      return !option.selected;
    });
    options.each(function (i, option) {
      option.selected = select;
    });
  },
});

var SettingsTab = BaseView.extend({
  el: '#tab',
  name: 'settings',
  events: {
    'change [data-check]': 'updateCheckbox',
    'change #sInjectMode': 'updateInjectMode',
    'click #bSelect': 'toggleSelection',
  },
  templateUrl: 'templates/tab-settings.html',
  render: function () {
    var options = _.options.getAll();
    this.$el.html(this.templateFn(options));
    this.$('#sInjectMode').val(options.injectMode);
    this.exportList = new ExportList;
    return this;
  },
  updateCheckbox: function (e) {
    var target = e.target;
    _.options.set(target.dataset.check, target.checked);
  },
  updateInjectMode: function (e) {
    _.options.set('injectMode', e.target.value);
  },
  toggleSelection: function () {
    this.exportList.toggleAll();
  },
});

var AboutTab = BaseView.extend({
  el: '#tab',
  name: 'about',
  templateUrl: 'templates/tab-about.html',
  render: function () {
    this.$el.html(this.templateFn());
    return this;
  },
});

var MainView = BaseView.extend({
  el: '#app',
  templateUrl: 'templates/main.html',
  tabs: {
    '': MainTab,
    settings: SettingsTab,
    about: AboutTab,
  },
  initialize: function (tab) {
    this.tab = this.tabs[tab] || this.tabs[''];
    BaseView.prototype.initialize.call(this);
  },
  render: function () {
    this.$el.html(this.templateFn({tab: this.tab.prototype.name}));
    this.view = new this.tab;
    return this;
  },
});

var ConfirmView = BaseView.extend({
  el: '#app',
  events: {
    'click .button-toggle': 'toggleButton',
    'click #btnClose': 'close',
  },
  templateUrl: 'templates/confirm.html',
  initialize: function (url) {
    this.url = url;
    BaseView.prototype.initialize.call(this);
  },
  render: function () {
    var _this = this;
    _this.$el.html(_this.templateFn({
      url: _this.url
    }));
    _this.showMessage(_.i18n('msgLoadingData'));
    Promise.all([
      _.initEditor({
        container: _this.$('.editor-code')[0],
        readonly: true,
        onexit: _this.close,
      }).then(function (editor) {
        _this.editor = editor;
      }),
      _this.getScript(_this.url).then(function (res) {
        _this.isLocal = !res.status;
        _this.scriptText = res.responseText;
      }),
    ]).then(function () {
      _this.editor.setValueAndFocus(_this.scriptText);
    });
    return _this;
  },
  toggleButton: function (e) {
    this.$(e.target).toggleClass('active');
  },
  close: function () {
    window.close();
  },
  showMessage: function (msg) {
    this.$('#msg').html(msg);
  },
  getScript: function (url) {
    var _this = this;
    var xhr = new XMLHttpRequest;
    xhr.open('GET', url, true);
    return new Promise(function (resolve, reject) {
      xhr.onload = function () {
        resolve(this);
      };
      xhr.onerror = function () {
        _this.showMessage(_.i18n('msgErrorLoadingData'));
        reject(this);
      };
      xhr.send();
    });
  },
});
