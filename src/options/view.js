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
  getValue: function (target) {
    var key = target.dataset.id;
    var value;
    switch (key[0]) {
    case '!':
      key = key.slice(1);
      value = target.checked;
      break;
    case '[':
      key = key.slice(1);
      value = _.filter(target.value.split('\n').map(function (s) {return s.trim();}));
      break;
    default:
      value = target.value;
    }
    return {
      key: key,
      value: value,
    };
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
    scriptList.trigger('edit:open', this.model);
  },
});

var MainTab = BaseView.extend({
  el: '#tab',
  name: 'main',
  templateUrl: 'templates/tab-installed.html',
  initialize: function () {
    var _this = this;
    BaseView.prototype.initialize.call(_this);
    _this.listenTo(scriptList, 'reset', _this.render);
    _this.listenTo(scriptList, 'add', _this.addOne);
    _this.listenTo(scriptList, 'add', _this.setBackdrop);
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
    'click #bImport': 'importFile',
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
  importData: function (file) {
    function getVMConfig(text) {
      var vm;
      try {
        vm = JSON.parse(text);
      } catch (e) {
        console.log('Error parsing ViolentMonkey configuration.');
      }
      vm = vm || {};
      _.forEach(vm.values, function (value, key) {
        _.sendMessage({
          cmd: 'SetValue',
          data: {
            url: key,
            values: value,
          }
        });
      });
      _.forEach(vm.settings, function (value, key) {
        _.options.set(key, value);
      });
      return vm;
    }
    function getVMFile(entry, vm) {
      if (!entry.filename.endsWith('.user.js')) return;
      vm = vm || {};
      return new Promise(function (resolve, reject) {
        var writer = new zip.TextWriter;
        entry.getData(writer, function (text) {
          var script = {code: text};
          if (vm.scripts) {
            var more = vm.scripts[entry.filename.slice(0, -8)];
            if (more) script.more = _.omit(more, ['id']);
          }
          _.sendMessage({
            cmd: 'ParseScript',
            data: script,
          }).then(function () {
            resolve(true);
          });
        });
      });
    }
    function getVMFiles(entries) {
      var i = entries.findIndex(function (entry) {
        return entry.filename === 'ViolentMonkey';
      });
      if (~i) return new Promise(function (resolve, reject) {
        var writer = new zip.TextWriter;
        entries[i].getData(writer, function (text) {
          entries.splice(i, 1);
          resolve({
            vm: getVMConfig(text),
            entries: entries,
          });
        });
      });
      return {
        entries: entries,
      };
    }
    function readZip(file) {
      return new Promise(function (resolve, reject) {
        zip.createReader(new zip.BlobReader(file), function (res) {
          res.getEntries(function (entries) {
            resolve(entries);
          });
        }, function (err) {reject(err);});
      });
    }
    readZip(file).then(getVMFiles).then(function (data) {
      var vm = data.vm;
      var entries = data.entries;
      return Promise.all(entries.map(function (entry) {
        return getVMFile(entry, vm);
      })).then(function (res) {
        return _.filter(res).length;
      });
    }).then(function (count) {
      scriptList.reload();
      alert(_.i18n('msgImported', [count]));
    });
  },
  importFile: function () {
    var _this = this;
    $('<input type=file>')
    .change(function (e) {
      if (this.files && this.files.length)
        _this.importData(this.files[0]);
    })
    .trigger('click');
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
    var _this = this;
    _this.tab = _this.tabs[tab] || _this.tabs[''];
    BaseView.prototype.initialize.call(_this);
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

var MetaView = BaseView.extend({
  className: 'button-panel',
  templateUrl: 'templates/edit-meta.html',
  events: {
    'change [data-id]': 'onChange',
  },
  render: function () {
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
});

var EditView = BaseView.extend({
  className: 'frame edit',
  templateUrl: 'templates/edit.html',
  events: {
    'click .button-toggle': 'toggleButton',
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
  },
  render: function () {
    var _this = this;
    var it = _this.model.toJSON();
    _this.$el.html(_this.templateFn(it));
    var gotScript = _.sendMessage({
      cmd: 'GetScript',
      data: it.id,
    });
    _this.loadedEditor = _.initEditor({
      container: _this.$('.editor-code')[0],
      onsave: _this.save.bind(_this),
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
    });
  },
  close: function () {
    if (!this.changed || confirm(_.i18n('confirmNotSaved')))
      scriptList.trigger('edit:close');
  },
  saveClose: function () {
    this.save().then(this.close.bind(this));
  },
  toggleButton: function (e) {
    if (this.metaView) {
      this.$(e.target).removeClass('active');
      this.metaView.remove();
      this.metaView = null;
    } else {
      this.$(e.target).addClass('active');
      this.metaView = new MetaView({model: this.metaModel});
      this.metaView.$el.insertAfter(e.target);
    }
  },
  updateCheckbox: function (e) {
    var res = this.getValue(e.target);
    this.model.set(res.key, res.value);
  },
});
