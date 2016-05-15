define('views/Menu', function (require, _exports, module) {
  var MenuBaseView = require('views/Base');
  var app = require('app');

  module.exports = MenuBaseView.extend({
    initialize: function () {
      var _this = this;
      MenuBaseView.prototype.initialize.call(_this);
      _this.listenTo(app.scriptsMenu, 'reset', _this.render);
      _this.listenTo(app.commandsMenu, 'reset', _this.render);
      _this.listenTo(app.domainsMenu, 'reset', _this.render);
    },
    _render: function () {
      var _this = this;
      _this.$el.html(_this.templateFn({
        hasSep: !!app.scriptsMenu.length,
      }));
      var comp = _this.components();
      var top = comp.top;
      var bot = comp.bot;
      _this.addMenuItem({
        name: _.i18n('menuManageScripts'),
        symbol: 'cog',
        onClick: function (_e) {
          var url = chrome.extension.getURL(chrome.app.getDetails().options_page);
          chrome.tabs.query({
            currentWindow: true,
            url: url,
          }, function (tabs) {
            var tab = _.find(tabs, function (tab) {
              var hash = tab.url.match(/#(\w+)/);
              return !hash || !_.includes(['confirm'], hash[1]);
            });
            if (tab) chrome.tabs.update(tab.id, {active: true});
            else chrome.tabs.create({url: url});
          });
        },
      }, top);
      app.domainsMenu.length && _this.addMenuItem({
        name: _.i18n('menuFindScripts'),
        symbol: 'search',
        onClick: function (_e) {
          var matches = app.currentTab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
          chrome.tabs.create({
            url: 'https://greasyfork.org/scripts/search?q=' + matches[1],
          });
        },
        onClickDetail: function (_e) {
          app.navigate('domains', {trigger: true});
        },
      }, top);
      app.commandsMenu.length && _this.addMenuItem({
        name: _.i18n('menuCommands'),
        symbol: 'arrow-right',
        onClick: function (_e) {
          app.navigate('commands', {trigger: true});
        },
      }, top);
      _this.addMenuItem({
        name: function (data) {
          return data ? _.i18n('menuScriptEnabled') : _.i18n('menuScriptDisabled');
        },
        data: _.options.get('isApplied'),
        symbol: function (data) {
          return data ? 'check' : 'remove';
        },
        onClick: function (_e, model) {
          var isApplied = !model.get('data');
          _.options.set('isApplied', isApplied);
          model.set({data: isApplied});
          chrome.browserAction.setIcon({
            path: {
              19: '/images/icon19' + (isApplied ? '' : 'w') + '.png',
              38: '/images/icon38' + (isApplied ? '' : 'w') + '.png'
            },
          });
        },
      }, top);
      app.scriptsMenu.each(function (item) {
        _this.addMenuItem(item, bot);
      });
      setTimeout(function () {
        _this.fixStyles(bot, comp.plh);
      });
    },
  });
});
