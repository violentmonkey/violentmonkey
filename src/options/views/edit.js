function fromList(list) {
  return (list || []).join('\n');
}
function toList(text) {
  return text.split('\n')
  .map(function (line) {
    return line.trim();
  })
  .filter(function (item) {
    return item;
  });
}
function findNext(cm, state, reversed) {
  cm.operation(function () {
    var query = state.query || '';
    var cursor = cm.getSearchCursor(query, reversed ? state.posFrom : state.posTo);
    if (!cursor.find(reversed)) {
      cursor = cm.getSearchCursor(query, reversed ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0));
      if (!cursor.find(reversed)) return;
    }
    cm.setSelection(cursor.from(), cursor.to());
    state.posFrom = cursor.from();
    state.posTo = cursor.to();
  });
}
function replaceOne(cm, state) {
  var start = cm.getCursor('start');
  var end = cm.getCursor('end');
  state.posTo = state.posFrom;
  findNext(cm, state);
  var start_ = cm.getCursor('start');
  var end_ = cm.getCursor('end');
  if (
    start.line === start_.line && start.ch === start_.ch
    && end.line === end_.line && end.ch === end_.ch
  ) {
    cm.replaceRange(state.replace, start, end);
    findNext(cm, state);
  }
}
function replaceAll(cm, state) {
  cm.operation(function () {
    var query = state.query || '';
    for (var cursor = cm.getSearchCursor(query); cursor.findNext();) {
      cursor.replace(state.replace);
    }
  });
}

var Message = require('./message');
var Editor = require('./editor');
var cache = require('../../cache');
var _ = require('../../common');

module.exports = {
  props: ['script'],
  template: cache.get('./edit.html'),
  components: {
    Editor: Editor,
  },
  data: function () {
    var _this = this;
    _this.debouncedFind = _.debounce(_this.find, 100);
    return {
      canSave: false,
      update: false,
      code: '',
      custom: {},
      search: {
        show: false,
        state: {
          query: null,
          replace: null,
        },
      },
      commands: {
        save: _this.save,
        cancel: function () {
          if (_this.search.show) {
            _this.clearSearch();
          } else {
            _this.close();
          }
        },
        find: _this.find,
        findNext: _this.findNext,
        findPrev: function () {
          _this.findNext(1);
        },
        replace: _this.replace,
        replaceAll: function () {
          _this.replace(1);
        },
      },
    };
  },
  computed: {
    placeholders: function () {
      var script = this.script;
      return {
        name: script.meta.name,
        homepageURL: script.meta.homepageURL,
        updateURL: script.meta.updateURL || _.i18n('hintUseDownloadURL'),
        downloadURL: script.meta.downloadURL || script.lastInstallURL,
      };
    },
  },
  watch: {
    custom: {
      deep: true,
      handler: function () {
        this.canSave = true;
      },
    },
    'search.state.query': function (query) {
      query && this.debouncedFind();
    },
  },
  mounted: function () {
    var _this = this;
    (_this.script.id ? _.sendMessage({
      cmd: 'GetScript',
      data: _this.script.id,
    }) : Promise.resolve(_this.script))
    .then(function (script) {
      _this.update = script.update;
      _this.code = script.code;
      var custom = script.custom;
      _this.custom = [
        'name',
        'homepageURL',
        'updateURL',
        'downloadURL',
      ].reduce(function (value, key) {
        value[key] = custom[key];
        return value;
      }, {
        keepInclude: custom._include !== false,
        keepMatch: custom._match !== false,
        keepExclude: custom._exclude !== false,
        include: fromList(custom.include),
        match: fromList(custom.match),
        exclude: fromList(custom.exclude),
        'run-at': custom['run-at'] || '',
      });
      _this.$nextTick(function () {
        _this.canSave = false;
      });
    });
  },
  beforeDestroy: function () {
    var _this = this;
    _this.cm && _this.unbindKeys();
  },
  methods: {
    save: function () {
      var _this = this;
      var custom = _this.custom;
      var value = [
        'name',
        'run-at',
        'homepageURL',
        'updateURL',
        'downloadURL',
      ].reduce(function (value, key) {
        value[key] = custom[key];
        return value;
      }, {
        _include: custom.keepInclude,
        _match: custom.keepMatch,
        _exclude: custom.keepExclude,
        include: toList(custom.include),
        match: toList(custom.match),
        exclude: toList(custom.exclude),
      });
      return _.sendMessage({
        cmd: 'ParseScript',
        data: {
          id: _this.script.id,
          code: _this.code,
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts
          isNew: !_this.script.id,
          message: '',
          more: {
            custom: value,
            update: _this.update,
          },
        },
      })
      .then(function (script) {
        _this.script = script;
        _this.canSave = false;
      }, function (err) {
        Message.open({text: err});
      });
    },
    close: function () {
      var _this = this;
      if (!_this.canSave || confirm(_.i18n('confirmNotSaved'))) {
        _this.$emit('close');
      }
    },
    saveClose: function () {
      var _this = this;
      _this.save().then(function () {
        _this.close();
      });
    },
    contentChange: function (code) {
      var _this = this;
      _this.code = code;
      _this.canSave = true;
    },
    initEditor: function (cm) {
      var _this = this;
      _this.cm = cm;
      _this.bindKeys();
    },
    find: function () {
      var _this = this;
      var state = _this.search.state;
      state.posTo = state.posFrom;
      _this.findNext();
    },
    findNext: function (reversed) {
      var _this = this;
      var state = _this.search.state;
      var cm = _this.cm;
      if (state.query) {
        findNext(cm, state, reversed);
      }
      _this.search.show = true;
      _this.$nextTick(function () {
        _this.$refs.search.focus();
      });
    },
    clearSearch: function () {
      var _this = this;
      var cm = _this.cm;
      cm.operation(function () {
        var state = _this.search.state;
        state.posFrom = state.posTo = null;
        _this.search.show = false;
      });
      cm.focus();
    },
    replace: function (all) {
      var _this = this;
      var cm = _this.cm;
      var state = _this.search.state;
      if (!state.query) {
        _this.find();
        return;
      }
      (all ? replaceAll : replaceOne)(cm, state);
    },
    onKeyDown: function (e) {
      var _this = this;
      var cm = _this.cm;
      var name = CodeMirror.keyName(e);
      var commands = [
        'cancel',
        'find',
        'findNext',
        'findPrev',
        'replace',
        'replaceAll',
      ];
      [
        cm.options.extraKeys,
        cm.options.keyMap,
      ].some(function (keyMap) {
        var stop = false;
        keyMap && CodeMirror.lookupKey(name, keyMap, function (b) {
          if (~commands.indexOf(b)) {
            e.preventDefault();
            e.stopPropagation();
            cm.execCommand(b);
            stop = true;
          }
        }, cm);
        return stop;
      });
    },
    bindKeys: function () {
      window.addEventListener('keydown', this.onKeyDown, false);
    },
    unbindKeys: function () {
      window.removeEventListener('keydown', this.onKeyDown, false);
    },
    goToLine: function () {
      var _this = this;
      var line = _this.search.line - 1;
      var cm = _this.cm;
      !isNaN(line) && cm.setCursor(line, 0);
      cm.focus();
    },
  },
};
