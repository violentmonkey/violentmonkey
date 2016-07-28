define('app', function (require, exports, _module) {
  var Menu = require('views/Menu');
  var Commands = require('views/Command');
  var Domains = require('views/Domain');
  var utils = require('utils');
  var _ = require('utils/common');

  var app = new Vue({
    el: document.body,
    components: {
      Menu: Menu,
      Commands: Commands,
      Domains: Domains,
    },
    data: function () {
      return {
        type: 'menu',
      };
    },
    methods: {
      navigate: function (type) {
        this.type = type || 'menu';
      },
    },
  });

  exports.navigate = app.navigate.bind(app);

  !function () {
    function init() {
      chrome.tabs.sendMessage(currentTab.id, {cmd: 'GetPopup'});
      if (currentTab && /^https?:\/\//i.test(currentTab.url)) {
        var matches = currentTab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
        var domain = matches[1];
        var domains = domain.split('.').reduceRight(function (res, part) {
          var last = res[0];
          if (last) part += '.' + last;
          res.unshift(part);
          return res;
        }, []);
        domains.length > 1 && domains.pop();
        utils.store.domains = domains;
      }
    }

    var currentTab;
    var commands = {
      SetPopup: function (data, src, _callback) {
        if (utils.store.currentTab.id !== src.tab.id) return;
        utils.store.commands = data.menus;
        _.sendMessage({
          cmd: 'GetMetas',
          data: data.ids,
        }).then(function (scripts) {
          utils.store.scripts = scripts;
        });
      },
    };
    chrome.runtime.onMessage.addListener(function (req, src, callback) {
      var func = commands[req.cmd];
      if (func) func(req.data, src, callback);
    });

    chrome.tabs.query({currentWindow: true, active: true}, function (tabs) {
      utils.store.currentTab = currentTab = {
        id: tabs[0].id,
        url: tabs[0].url,
      };
      init();
    });
  }();
});
