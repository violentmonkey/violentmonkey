define('views/Edit', function (require, _exports, module) {
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

  var Message = require('views/Message');
  var Editor = require('views/Editor');
  var cache = require('cache');

  module.exports = {
    props: {
      script: {
        twoWay: true,
      },
    },
    template: cache.get('/options/components/edit.html'),
    components: {
      Editor: Editor,
    },
    data: function () {
      return {
        canSave: false,
        update: false,
        code: '',
        custom: {},
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
      code: function () {
        this.canSave = true;
      },
      custom: {
        deep: true,
        handler: function () {
          this.canSave = true;
        },
      },
    },
    ready: function () {
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
          new Message({text: err});
        });
      },
      close: function () {
        var _this = this;
        if (!_this.canSave || confirm(_.i18n('confirmNotSaved'))) {
          _this.script = null;
        }
      },
      saveClose: function () {
        var _this = this;
        _this.save().then(function () {
          _this.close();
        });
      },
    },
  };
});
