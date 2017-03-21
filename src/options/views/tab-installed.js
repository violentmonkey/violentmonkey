var ScriptItem = require('./script');
var Edit = require('./edit');
var cache = require('../../cache');
var _ = require('../../common');
var utils = require('../utils');
var store = utils.store;

module.exports = {
  template: cache.get('./tab-installed.html'),
  components: {
    ScriptItem: ScriptItem,
    Edit: Edit,
  },
  data: function () {
    return {
      script: null,
      store: store,
    };
  },
  computed: {
    message: function () {
      var _this = this;
      if (_this.store.loading) {
        return _.i18n('msgLoading');
      }
      if (!_this.store.scripts.length) {
        return _.i18n('labelNoScripts');
      }
    },
  },
  methods: {
    newScript: function () {
      var _this = this;
      _.sendMessage({cmd: 'NewScript'})
      .then(function (script) {
        _this.script = script;
      });
    },
    updateAll: function () {
      _.sendMessage({cmd: 'CheckUpdateAll'});
    },
    installFromURL: function () {
      var url = prompt(_.i18n('hintInputURL'));
      if (url && ~url.indexOf('://')) {
        browser.tabs.create({
          url: browser.runtime.getURL('/options/index.html') + '#confirm/' + encodeURIComponent(url),
        });
      }
    },
    editScript: function (id) {
      var _this = this;
      _this.script = _this.store.scripts.find(function (script) {
        return script.id === id;
      });
    },
    endEditScript: function () {
      this.script = null;
    },
    moveScript: function (data) {
      var _this = this;
      if (data.from === data.to) return;
      _.sendMessage({
        cmd: 'Move',
        data: {
          id: _this.store.scripts[data.from].id,
          offset: data.to - data.from,
        },
      })
      .then(function () {
        var scripts = _this.store.scripts;
        var i = Math.min(data.from, data.to);
        var j = Math.max(data.from, data.to);
        var seq = [
          scripts.slice(0, i),
          scripts.slice(i, j + 1),
          scripts.slice(j + 1),
        ];
        i === data.to
          ? seq[1].unshift(seq[1].pop())
          : seq[1].push(seq[1].shift());
        _this.store.scripts = seq.concat.apply([], seq);
      });
    },
  },
};
