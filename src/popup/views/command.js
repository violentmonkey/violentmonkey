var CommandsView = MenuBaseView.extend({
  initialize: function () {
    MenuBaseView.prototype.initialize.call(this);
    this.listenTo(commandsMenu, 'reset', this.render);
  },
  _render: function () {
    if (!commandsMenu.length)
      return app.navigate('', {trigger: true, replace: true});
    var _this = this;
    _this.$el.html(_this.templateFn({
      hasSep: true
    }));
    var comp = _this.components();
    var top = comp.top;
    var bot = comp.bot;
    _this.addMenuItem({
      name: _.i18n('menuBack'),
      symbol: 'arrow-left',
      onClick: function (e) {
        app.navigate('', {trigger: true});
      },
    }, top);
    commandsMenu.each(function (item) {
      _this.addMenuItem(item, bot);
    });
    setTimeout(function () {
      _this.fixStyles(bot, comp.plh);
    });
  },
});
