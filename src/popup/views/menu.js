var app = require('../app');
var MixIn = require('./mixin');
var _ = require('../../common');

module.exports = {
  mixins: [MixIn],
  mounted: function () {
    var _this = this;
    _this.items.top.push({
      name: _.i18n('menuManageScripts'),
      symbol: 'cog',
      onClick: function () {
        var url = chrome.extension.getURL(chrome.app.getDetails().options_page);
        chrome.tabs.query({
          currentWindow: true,
          url: url,
        }, function (tabs) {
          var tab = tabs.find(function (tab) {
            var hash = tab.url.match(/#(\w+)/);
            return !hash || hash[1] !== 'confirm';
          });
          if (tab) chrome.tabs.update(tab.id, {active: true});
          else chrome.tabs.create({url: url});
        });
      },
    }, _this.menuFindScripts = {
      name: _.i18n('menuFindScripts'),
      symbol: 'search',
      hide: false,
      onClick: function () {
        var matches = _this.store.currentTab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
        chrome.tabs.create({
          url: 'https://greasyfork.org/scripts/search?q=' + matches[1],
        });
      },
      detailClick: function () {
        app.navigate('Domains');
      },
    }, _this.menuCommands = {
      name: _.i18n('menuCommands'),
      symbol: 'arrow-right',
      hide: false,
      onClick: function () {
        app.navigate('Commands');
      },
    }, {
      name: null,
      symbol: null,
      disabled: null,
      init: function (options) {
        options.disabled = !_.options.get('isApplied');
        options.name = options.disabled ? _.i18n('menuScriptDisabled') : _.i18n('menuScriptEnabled');
        options.symbol = options.disabled ? 'remove' : 'check';
      },
      onClick: function (options) {
        _.options.set('isApplied', options.disabled);
        options.init.call(this, options);
        chrome.browserAction.setIcon({
          path: {
            19: '/images/icon19' + (options.disabled ? 'w' : '') + '.png',
            38: '/images/icon38' + (options.disabled ? 'w' : '') + '.png',
          },
        });
      },
    });
    _this.updateDomains();
    _this.updateCommands();
  },
  watch: {
    'store.scripts': 'update',
    'store.commands': 'updateCommands',
    'store.domains': 'updateDomains',
  },
  methods: {
    updateView: function () {
      var _this = this;
      _this.items.bot = _this.store.scripts.map(function (script) {
        return {
          name: script.custom.name || _.getLocaleString(script.meta, 'name'),
          className: 'ellipsis',
          symbol: null,
          disabled: null,
          init: function (options) {
            options.disabled = !script.enabled;
            options.symbol = options.disabled ? 'remove' : 'check';
          },
          onClick: function (options) {
            var vm = this;
            _.sendMessage({
              cmd: 'UpdateScriptInfo',
              data: {
                id: script.id,
                enabled: !script.enabled,
              },
            }).then(function () {
              script.enabled = !script.enabled;
              options.init.call(vm, options);
              _.options.get('autoReload') && chrome.tabs.reload(_this.store.currentTab.id);
            });
          },
        };
      });
    },
    updateCommands: function () {
      var _this = this;
      var commands = _this.store.commands;
      _this.menuCommands.hide = !commands || !commands.length;
    },
    updateDomains: function () {
      var _this = this;
      var domains = _this.store.domains;
      _this.menuFindScripts.hide = !domains || !domains.length;
    },
  },
};
