var _ = require('src/common');
var cache = require('src/cache');
var Icon = require('../icon');
var utils = require('../../utils');

var options = {
  isApplied: _.options.get('isApplied'),
};
_.options.hook(function (changes) {
  if ('isApplied' in changes) {
    options.isApplied = changes.isApplied;
  }
});

module.exports = {
  template: cache.get('./index.html'),
  components: {
    Icon: Icon,
  },
  data: function () {
    return {
      options: options,
      activeMenu: 'scripts',
      store: utils.store,
      collapse: {
        domains: true,
        commands: true,
        scripts: false,
      },
    };
  },
  computed: {
    domains: function () {
      return this.store.domains.map(function (item) {
        return {
          name: item,
          data: item,
        };
      });
    },
    commands: function () {
      return this.store.commands.map(function (item) {
        return {
          name: item[0],
          data: item,
        };
      });
    },
    scripts: function () {
      return this.store.scripts.map(function (script) {
        return {
          name: script.custom.name || _.getLocaleString(script.meta, 'name'),
          data: script,
        };
      });
    },
  },
  methods: {
    toggleMenu: function (name) {
      this.activeMenu = this.activeMenu === name ? null : name;
    },
    getSymbolCheck: function (bool) {
      return bool ? 'check' : 'remove';
    },
    onToggle: function () {
      _.options.set('isApplied', !this.options.isApplied);
    },
    onManage: function () {
      var url = browser.runtime.getURL(browser.runtime.getManifest().options_page);
      browser.tabs.query({
        currentWindow: true,
        url: url,
      })
      .then(function (tabs) {
        var tab = tabs.find(function (tab) {
          var hash = tab.url.match(/#(\w+)/);
          return !hash || hash[1] !== 'confirm';
        });
        if (tab) browser.tabs.update(tab.id, {active: true});
        else browser.tabs.create({url: url});
      });
    },
    onFindScripts: function (item) {
      var domain;
      if (item) {
        domain = item.name;
      } else {
        var matches = this.store.currentTab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
        domain = matches[1];
      }
      browser.tabs.create({
        url: 'https://greasyfork.org/scripts/search?q=' + encodeURIComponent(domain),
      });
    },
    onCommand: function (item) {
      browser.tabs.sendMessage(this.store.currentTab.id, {
        cmd: 'Command',
        data: item.name,
      });
    },
    onToggleScript: function (item) {
      var _this = this;
      _.sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: item.data.id,
          enabled: !item.data.enabled,
        },
      })
      .then(function () {
        item.data.enabled = !item.data.enabled;
        _.options.get('autoReload') && browser.tabs.reload(_this.store.currentTab.id);
      });
    },
  },
};
