define('app', function (require, exports, _module) {
  var models = require('models');
  var Menu = models.Menu;
  var MenuItem = models.MenuItem;
  var MenuView = require('views/Menu');
  var CommandsView = require('views/Command');
  var DomainsView = require('views/Domain');
  var cache = require('cache');

  exports.scriptsMenu = new Menu;
  exports.commandsMenu = new Menu;
  exports.domainsMenu = new Menu;

  var App = cache.BaseRouter.extend({
    routes: {
      '': 'renderMenu',
      commands: 'renderCommands',
      domains: 'renderDomains',
    },
    renderMenu: function () {
      this.loadView('menu', function () {
        return new MenuView;
      });
    },
    renderCommands: function () {
      this.loadView('commands', function () {
        return new CommandsView;
      });
    },
    renderDomains: function () {
      this.loadView('domains', function () {
        return new DomainsView;
      });
    },
  });
  var app = new App('#app');
  Backbone.history.start() || app.navigate('', {trigger: true, replace: true});
  exports.navigate = app.navigate.bind(app);
  var currentTab;

  !function () {
    function commandClick(_e, model) {
      chrome.tabs.sendMessage(currentTab.id, {
        cmd: 'Command',
        data: model.get('name'),
      });
    }
    function domainClick(_e, model) {
      chrome.tabs.create({
        url: 'https://greasyfork.org/scripts/search?q=' + model.get('name'),
      });
    }
    function scriptSymbol(data) {
      return data ? 'check' : 'remove';
    }
    function scriptClick(_e, model) {
      var data = !model.get('data');
      _.sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: model.get('id'),
          enabled: data,
        },
      }).then(function () {
        model.set({data: data});
        _.options.get('autoReload') && chrome.tabs.reload(currentTab.id);
      });
    }
    function init() {
      chrome.tabs.sendMessage(currentTab.id, {cmd: 'GetPopup'});
      if (currentTab && /^https?:\/\//i.test(currentTab.url)) {
        var matches = currentTab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
        var domain = matches[1];
        var pieces = domain.split('.').reverse();
        var domains = [];
        var last = pieces.shift();
        pieces.forEach(function (piece) {
          last = piece + '.' + last;
          domains.unshift(last);
        });
        if (!domains.length) domains.push(domain);
        exports.domainsMenu.reset(domains.map(function (domain) {
          return new MenuItem({
            name: domain,
            title: true,
            className: 'ellipsis',
            onClick: domainClick,
          });
        }));
      }
    }

    var commands = {
      SetPopup: function (data, src, _callback) {
        if (currentTab.id !== src.tab.id) return;
        exports.commandsMenu.reset(data.menus.map(function (menu) {
          return new MenuItem({
            name: menu[0],
            symbol: 'right-hand',
            title: true,
            className: 'ellipsis',
            onClick: commandClick,
          });
        }));
        _.sendMessage({
          cmd: 'GetMetas',
          data: data.ids,
        }).then(function (scripts) {
          exports.scriptsMenu.reset(scripts.map(function (script) {
            return new MenuItem({
              id: script.id,
              name: script.custom.name || _.getLocaleString(script.meta, 'name'),
              data: !!script.enabled,
              symbol: scriptSymbol,
              title: true,
              className: 'ellipsis',
              onClick: scriptClick,
            });
          }));
        });
      },
    };
    chrome.runtime.onMessage.addListener(function (req, src, callback) {
      var func = commands[req.cmd];
      if (func) func(req.data, src, callback);
    });

    chrome.tabs.query({currentWindow: true, active: true}, function (tabs) {
      currentTab = exports.currentTab = tabs[0];
      init();
    });
  }();
});
