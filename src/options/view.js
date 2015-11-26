var DEFAULT_ICON = '/images/icon48.png';
var ScriptView = BaseView.extend({
  className: 'script',
  attributes: {
    draggable: true,
  },
  templateUrl: '/options/templates/script.html',
  events: {
    'click [data-id=edit]': 'onEdit',
    'click [data-id=remove]': 'onRemove',
    'click [data-id=enable]': 'onEnable',
    'click [data-id=update]': 'onUpdate',
    'dragstart': 'onDragStart',
  },
  initialize: function () {
    var _this = this;
    _this.model.set('_icon', DEFAULT_ICON);
    BaseView.prototype.initialize.call(_this);
    _this.listenTo(_this.model, 'change', _this.render);
    _this.listenTo(_this.model, 'remove', _this.onRemoved);
  },
  loadIcon: function () {
    var _this = this;
    var icon = _this.model.get('meta').icon;
    if (icon && icon !== _this.model.get('_icon'))
      _this.loadImage(icon).then(function () {
        _this.model.set('_icon', icon);
      }, function () {
        _this.model.set('_icon', DEFAULT_ICON);
      });
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
    else _this.$el.removeClass('disabled');
    _this.loadIcon();
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
  onRemove: function () {
    var _this = this;
    _.sendMessage({
      cmd: 'RemoveScript',
      data: _this.model.id,
    }).then(function () {
      scriptList.remove(_this.model);
    });
  },
  onRemoved: function () {
    this.$el.remove();
  },
  onEnable: function () {
    var _this = this;
    _.sendMessage({
      cmd: 'UpdateScriptInfo',
      data: {
        id: _this.model.id,
        enabled: _this.model.get('enabled') ? 0 : 1,
      },
    });
  },
  onUpdate: function () {
    _.sendMessage({
      cmd: 'CheckUpdate',
      data: this.model.id,
    });
  },
  onDragStart: function (e) {
    var model = this.model;
    new DND(e, function (data) {
      if (data.from === data.to) return;
      _.sendMessage({
        cmd: 'Move',
        data: {
          id: model.id,
          offset: data.to - data.from,
        }
      }).then(function () {
        var collection = model.collection;
        var models = collection.models;
        var i = Math.min(data.from, data.to);
        var j = Math.max(data.from, data.to);
        var seq = [
          models.slice(0, i),
          models.slice(i, j + 1),
          models.slice(j + 1),
        ];
        i === data.to
        ? seq[1].unshift(seq[1].pop())
        : seq[1].push(seq[1].shift());
        collection.models = seq.concat.apply([], seq);
      });
    });
  },
});

function DND(e, cb) {
  this.mousemove = this.mousemove.bind(this);
  this.mouseup = this.mouseup.bind(this);
  if (e) {
    e.preventDefault();
    this.start(e);
  }
  this.onDrop = cb;
}
DND.prototype.start = function (e) {
  var dragging = this.dragging = {
    el: e.currentTarget,
  };
  var $el = dragging.$el = $(dragging.el);
  var parent = $el.parent();
  var offset = $el.offset();
  dragging.offset = {
    x: e.clientX - offset.left,
    y: e.clientY - offset.top,
  };
  var next = $el.next();
  dragging.delta = (next.length ? next.offset().top : parent.height()) - offset.top;
  var children = parent.children();
  dragging.lastIndex = dragging.index = children.index($el);
  dragging.$elements = children.not($el);
  dragging.$dragged = $el.clone().addClass('dragging').css({
    left: offset.left,
    top: offset.top,
    width: offset.width,
  }).appendTo(parent);
  $el.addClass('dragging-placeholder');
  $(document).on('mousemove', this.mousemove).on('mouseup', this.mouseup);
};
DND.prototype.mousemove = function (e) {
  var dragging = this.dragging;
  dragging.$dragged.css({
    left: e.clientX - dragging.offset.x,
    top: e.clientY - dragging.offset.y,
  });
  var hovered = null;
  dragging.$elements.each(function (i, el) {
    var $el = $(el);
    if ($el.hasClass('dragging-moving')) return;
    var offset = $el.offset();
    var pad = 10;
    if (
      e.clientX >= offset.left + pad
      && e.clientX <= offset.left + offset.width - pad
      && e.clientY >= offset.top + pad
      && e.clientY <= offset.top + offset.height - pad
    ) {
      hovered = {
        index: i,
        el: el,
      };
      return false;
    }
  });
  if (hovered) {
    var lastIndex = dragging.lastIndex;
    var index = hovered.index;
    var isDown = index >= lastIndex;
    var $el = dragging.$el;
    var delta = dragging.delta;
    if (isDown) {
      // If moving down, the actual index should be `index + 1`
      index ++;
      $el.insertAfter(hovered.el);
    } else {
      delta = -delta;
      $el.insertBefore(hovered.el);
    }
    dragging.lastIndex = index;
    this.animate(dragging.$elements.slice(
      isDown ? lastIndex : index,
      isDown ? index : lastIndex
    ), delta);
  }
};
DND.prototype.animate = function ($elements, delta) {
  $elements.each(function (i, el) {
    var $el = $(el);
    $el.addClass('dragging-moving').css({
      transition: 'none',
      transform: 'translateY(' + delta + 'px)',
    }).one('transitionend', function (e) {
      $(e.target).removeClass('dragging-moving');
    });
    setTimeout(function () {
      $el.css({
        transition: '',
        transform: '',
      });
    }, 20);
  });
};
DND.prototype.mouseup = function (e) {
  $(document).off('mousemove', this.mousemove).off('mouseup', this.mouseup);
  var dragging = this.dragging;
  dragging.$dragged.remove();
  dragging.$el.removeClass('dragging-placeholder');
  this.dragging = null;
  this.onDrop && this.onDrop({
    from: dragging.index,
    to: dragging.lastIndex,
  });
};

var MainTab = BaseView.extend({
  el: '#tab',
  name: 'main',
  templateUrl: '/options/templates/tab-installed.html',
  events: {
    'click #bNew': 'newScript',
    'click #bUpdate': 'updateAll',
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
  newScript: function () {
    _.sendMessage({cmd: 'NewScript'}).then(function (script) {
      scriptList.trigger('edit:open', new Script(script));
    });
  },
  updateAll: function () {
    _.sendMessage({cmd: 'CheckUpdateAll'});
  },
});

var ExportList = BaseView.extend({
  el: '.export-list',
  templateUrl: '/options/templates/option.html',
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
    this.$('option').each(function (i, option) {
      if (option.selected) selected.push(scriptList.at(i));
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
    'change #cUpdate': 'updateAutoUpdate',
    'click #bSelect': 'toggleSelection',
    'click #bImport': 'importFile',
    'click #bExport': 'exportData',
    'click #bVacuum': 'onVacuum',
  },
  templateUrl: '/options/templates/tab-settings.html',
  render: function () {
    var options = _.options.getAll();
    this.$el.html(this.templateFn(options));
    this.$('#sInjectMode').val(options.injectMode);
    this.exportList = new ExportList;
    return this;
  },
  updateCheckbox: _.updateCheckbox,
  updateAutoUpdate: function (e) {
    _.sendMessage({cmd: 'AutoUpdate'});
  },
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
    $('<input type=file accept=".zip">')
    .change(function (e) {
      if (this.files && this.files.length)
        _this.importData(this.files[0]);
    })
    .trigger('click');
  },
  exportData: function () {
    function getWriter() {
      return new Promise(function (resolve, reject) {
        zip.createWriter(new zip.BlobWriter, function (writer) {
          resolve(writer);
        });
      });
    }
    function addFile(writer, file) {
      return new Promise(function (resolve, reject) {
        writer.add(file.name, new zip.TextReader(file.content), function () {
          resolve(writer);
        });
      });
    }
    function download(writer) {
      return new Promise(function (resolve, reject) {
        writer.close(function (blob) {
          var url = URL.createObjectURL(blob);
          $('<a>').attr({
            href: url,
            download: 'scripts.zip',
          }).trigger('click');
          URL.revokeObjectURL(url);
          resolve();
        });
      });
    }
    var bExport = this.$('#bExport');
    bExport.prop('disabled', true);
    var selected = this.exportList.getSelected();
    if (!selected.length) return;
    var withValues = this.$('#cbValues').prop('checked');
    _.sendMessage({
      cmd: 'ExportZip',
      data: {
        values: withValues,
        ids: _.pluck(selected, 'id'),
      }
    }).then(function (data) {
      var names = {};
      var vm = {
        scripts: {},
        settings: _.options.getAll(),
      };
      if (withValues) vm.values = {};
      var files = data.scripts.map(function (script) {
        var name = script.custom.name || script.meta.name || 'Noname';
        if (names[name]) name += '_' + (++ names[name]);
        else names[name] = 1;
        vm.scripts[name] = _.pick(script, ['id', 'custom', 'enabled', 'update']);
        if (withValues) {
          var values = data.values[script.uri];
          if (values) vm.values[script.uri] = values;
        }
        return {
          name: name + '.user.js',
          content: script.code,
        };
      });
      files.push({
        name: 'ViolentMonkey',
        content: JSON.stringify(vm),
      });
      return files;
    }).then(function (files) {
      return files.reduce(function (result, file) {
        return result.then(function (writer) {
          return addFile(writer, file);
        });
      }, getWriter()).then(download);
    }).then(function () {
      bExport.prop('disabled', false);
    });
  },
  onVacuum: function (e) {
    var button = $(e.target);
    button.prop('disabled', true).html(_.i18n('buttonVacuuming'));
    _.sendMessage({cmd: 'Vacuum'}).then(function () {
      button.html(_.i18n('buttonVacuumed'));
    });
  },
});

var AboutTab = BaseView.extend({
  el: '#tab',
  name: 'about',
  templateUrl: '/options/templates/tab-about.html',
  render: function () {
    this.$el.html(this.templateFn());
    return this;
  },
});

var MainView = BaseView.extend({
  el: '#app',
  templateUrl: '/options/templates/main.html',
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
  templateUrl: '/options/templates/confirm.html',
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
  templateUrl: '/options/templates/edit-meta.html',
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
  templateUrl: '/options/templates/edit.html',
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
    var gotScript = it.id ? _.sendMessage({
      cmd: 'GetScript',
      data: it.id,
    }) : Promise.resolve(it);
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
