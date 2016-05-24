define('views/Domain', function (require, _exports, module) {
  var MenuBaseView = require('views/Base');
  var app = require('app');

  module.exports = MenuBaseView.extend({
    initialize: function () {
      var _this = this;
      MenuBaseView.prototype.initialize.call(_this);
      _this.listenTo(app.domainsMenu, 'reset', _this.render);
    },
    _render: function () {
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
        onClick: function (_e) {
          app.navigate('', {trigger: true});
        },
      }, top);
      app.domainsMenu.each(function (item) {
        _this.addMenuItem(item, bot);
      });
      _this.fixStyles(bot, comp.plh);
    },
  });
});
