var ConfirmView = BaseView.extend({
  el: '#app',
  events: {
    'click .button-toggle': 'toggleOptions',
    'click #btnInstall': 'installScript',
    'click #btnClose': 'close',
  },
  templateUrl: '/options/templates/confirm.html',
  initialize: function (url, _from) {
    this.url = url;
    this.from = _from;
    _.bindAll(this, 'hideOptions');
    BaseView.prototype.initialize.call(this);
  },
  _render: function () {
    var _this = this;
    _this.$el.html(_this.templateFn({
      url: _this.url,
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
    _this.$toggler = _this.$('.button-toggle');
  },
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
  hideOptions: function () {
    if (!this.optionsView) return;
    this.$toggler.removeClass('active');
    this.optionsView.remove();
    this.optionsView = null;
  },
  toggleOptions: function (e) {
    if (this.optionsView) {
      this.hideOptions();
    } else {
      this.$toggler.addClass('active');
      this.optionsView = new ConfirmOptionsView;
      this.optionsView.$el.insertAfter(this.$toggler);
      $(document).one('mousedown', this.hideOptions);
    }
  },
  close: function () {
    window.close();
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
