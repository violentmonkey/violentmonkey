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
  className: 'script',
  templateUrl: 'templates/script.html',
  events: {
    'click [data-id=edit]': 'onEdit',
  },
  initialize: function () {
    BaseView.prototype.initialize.call(this);
    this.listenTo(this.model, 'change', this.render);
  },
  render: function () {
    var _this = this;
    var model = _this.model;
    var it = model.toJSON();
    it.getLocaleString = model.getLocaleString.bind(model);
    it.canUpdate = model.canUpdate();
    it.homepageURL = it.custom.homepageURL || it.meta.homepageURL || it.meta.homepage;
    it.author = _this.getAuthor(it.meta.author);
    _this.$el.html(_this.templateFn(it));
    if (!it.enabled) _this.$el.addClass('disabled');
    _this.$('img[data-src]').each(function (i, img) {
      if (img.dataset.src) _this.loadImage(img.dataset.src).then(function () {
        img.src = img.dataset.src;
      });
    });
    return _this;
  },
  getAuthor: function (text) {
    if (!text) return '';
    var matches = text.match(/^(.*?)\s<(\S*?@\S*?)>$/);
    var label = _.i18n('labelAuthor');
    return matches
      ? label + '<a href=mailto:' + matches[2] + '>' + matches[1] + '</a>'
      : label + _.escape(text);
  },
  images: {},
  loadImage: function (url) {
    if (!url) return;
    var promise = this.images[url];
    if (!promise) promise = this.images[url] = new Promise(function (resolve, reject) {
      var img = new Image;
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(url);
      };
      img.src = url;
    });
    return promise;
  },
  onEdit: function () {
    Backbone.trigger('edit', this.model);
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
    this.$list = this.$('.scripts');
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
  initialize: function () {
    BaseView.prototype.initialize.call(this);
    this.listenTo(scriptList, 'reset change', this.render);
  },
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
  updateCheckbox: _.updateCheckbox,
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
    Backbone.on('edit', function (model) {
      console.log(model);
    });
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
    'click #btnInstall': 'installScript',
    'click #btnClose': 'close',
    'change [data-check]': 'updateCheckbox',
    'change #cbClose': 'updateClose',
  },
  templateUrl: 'templates/confirm.html',
  initialize: function (url, _from) {
    this.url = url;
    this.from = _from;
    BaseView.prototype.initialize.call(this);
  },
  render: function () {
    var _this = this;
    _this.$el.html(_this.templateFn({
      url: _this.url,
      options: _.options.getAll(),
    }));
    _this.showMessage(_.i18n('msgLoadingData'));
    _this.loadedEditor = _.initEditor({
      container: _this.$('.editor-code')[0],
      readonly: true,
      onexit: _this.close,
    }).then(function (editor) {
      _this.editor = editor;
    });
    _this.loadData().then(function () {
      _this.parseMeta();
    });
    return _this;
  },
  updateCheckbox: _.updateCheckbox,
  loadData: function () {
    var _this = this;
    _this.$('#btnInstall').prop('disabled', true);
    _this.data = {
      require: {},
      resources: {},
      dependencyOK: false,
      isLocal: false,
    };
    return _this.getScript(_this.url).then(function (res) {
      _this.data.isLocal = !res.status;
      _this.data.code = res.responseText;
      _this.loadedEditor.then(function () {
        _this.editor.setValueAndFocus(_this.data.code);
      });
    });
  },
  parseMeta: function () {
    var _this = this;
    return _.sendMessage({
      cmd: 'ParseMeta',
      data: _this.data.code,
    }).then(function (script) {
      var urls = _.values(script.resources);
      var length = script.require.length + urls.length;
      var finished = 0;
      if (!length) return;
      var error = [];
      var updateStatus = function () {
        _this.showMessage(_.i18n('msgLoadingDependency', [finished, length]));
      };
      updateStatus();
      var promises = script.require.map(function (url) {
        return _this.getFile(url).then(function (res) {
          _this.data.require[url] = res;
        });
      });
      promises = promises.concat(urls.map(function (url) {
        return _this.getFile(url, true).then(function (res) {
          _this.data.resources[url] = res;
        });
      }));
      promises = promises.map(function (promise) {
        return promise.then(function () {
          finished += 1;
          updateStatus();
        }, function (url) {
          error.push(url);
        });
      });
      return Promise.all(promises).then(function () {
        if (error.length) return Promise.reject(error.join('\n'));
        _this.data.dependencyOK = true;
      });
    }).then(function () {
      _this.showMessage(_.i18n('msgLoadedData'));
      _this.$('#btnInstall').prop('disabled', false);
    }, function (error) {
      _this.showMessage(_.i18n('msgErrorLoadingDependency'), error);
      return Promise.reject();
    });
  },
  toggleButton: function (e) {
    this.$(e.target).toggleClass('active');
  },
  close: function () {
    window.close();
  },
  updateClose: function (e) {
    this.$('#cbTrack').prop('disabled', e.target.checked);
  },
  showMessage: function (msg) {
    this.$('#msg').html(msg);
  },
  getFile: function (url, isBlob) {
    var xhr = new XMLHttpRequest;
    xhr.open('GET', url, true);
    if (isBlob) xhr.responseType = 'blob';
    return new Promise(function (resolve, reject) {
      xhr.onload = function () {
        if (isBlob) {
          var reader = new FileReader;
          reader.onload = function (e) {
            resolve(window.btoa(this.result));
          };
          reader.readAsBinaryString(this.response);
        } else {
          resolve(xhr.responseText);
        }
      };
      xhr.onerror = function () {
        reject(url);
      };
      xhr.send();
    });
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
  getTimeString: function () {
		var now = new Date();
		return _.zfill(now.getHours(), 2) + ':' +
			_.zfill(now.getMinutes(), 2) + ':' +
			_.zfill(now.getSeconds(), 2);
  },
  installScript: function () {
    var _this = this;
    _this.$('#btnInstall').prop('disabled', true);
    _.sendMessage({
			cmd:'ParseScript',
			data:{
				url: _this.url,
				from: _this.from,
				code: _this.data.code,
				require: _this.data.require,
				resources: _this.data.resources,
			},
    }).then(function (res) {
      _this.showMessage(res.message + '[' + _this.getTimeString() + ']');
      if (res.code < 0) return;
      if (_.options.get('closeAfterInstall')) _this.close();
      else if (_this.data.isLocal && _.options.get('trackLocalFile')) _this.trackLocalFile();
    });
  },
  trackLocalFile: function () {
    var _this = this;
    setTimeout(function () {
      var code = _this.data.code;
      _this.loadData().then(function () {
        var track = _.options.get('trackLocalFile');
        if (!track) return;
        if (_this.data.code != code)
          _this.parseMeta().then(function () {
            track && _this.installScript();
          });
        else
          _this.trackLocalFile();
      });
    }, 2000);
  },
});

var EditView = BaseView.extend({
  el: '#edit',
  templateUrl: 'templates/edit.html',
  initialize: function (id) {
    this.sid = id;
    BaseView.prototype.initialize.call(this);
  },
  render: function () {
    this.$el.html(this.templateFn());
  },
});
