var App = Backbone.Router.extend({
  routes: {
    '': 'renderMenu',
    'commands': 'renderCommands',
  },
  renderMenu: function () {
    this.view = new MenuView;
  },
  renderCommands: function () {
    this.view = new CommandsView;
  },
});
var app = new App();
if (!Backbone.history.start())
  app.navigate('', {trigger: true, replace: true});

BaseView.prototype.initI18n.call(window);

!function () {
  function commandClick(e, model) {
    chrome.tabs.sendMessage(app.currentTab.id, {
      cmd: 'Command',
      data: model.get('name'),
    });
  }
  function scriptSymbol(data) {
    return data ? 'fa-check' : 'fa-times';
  }
  function scriptClick(e, model) {
    var data = !model.get('data');
    _.sendMessage({
      cmd: 'UpdateScriptInfo',
      data: {
        id: model.get('id'),
        enabled: data,
      },
    }).then(function () {
      model.set({data: data});
      _.options.get('autoReload') && chrome.tabs.reload(app.currentTab.id);
    });
  }
  function init() {
    chrome.tabs.sendMessage(app.currentTab.id, {cmd: 'GetPopup'});
  }

  var commands = {
    SetPopup: function (data, src, callback) {
      if (app.currentTab.id !== src.tab.id) return;
      commandsMenu.reset(data.menus.map(function (menu) {
        return new MenuItem({
          name: menu[0],
          symbol: 'fa-hand-o-right',
          title: true,
          //className: 'ellipsis',
          onClick: commandClick,
        });
      }));
      _.sendMessage({
        cmd: 'GetMetas',
        data: data.ids,
      }).then(function (scripts) {
        scriptsMenu.reset(scripts.map(function (script) {
          return new MenuItem({
            id: script.id,
            name: script.custom.name || _.getLocaleString(script.meta, 'name'),
            data: script.enabled,
            symbol: scriptSymbol,
            title: true,
            //className: 'ellipsis',
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
    app.currentTab = tabs[0];
    init();
  });
}();
