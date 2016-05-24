define('views/Base', function (require, _exports, module) {
  var BaseView = require('cache').BaseView;
  var MenuItem = require('models').MenuItem;
  var MenuItemView = require('views/MenuItem');

  module.exports = BaseView.extend({
    templateUrl: '/popup/templates/menu.html',
    addMenuItem: function (obj, parent) {
      if (!(obj instanceof MenuItem)) obj = new MenuItem(obj);
      var item = new MenuItemView({model: obj});
      parent.append(item.$el);
      this.childViews.push(item);
    },
    components: function () {
      var $el = this.$el;
      var children = $el.children();
      return {
        top: children.first(),
        bot: children.last(),
        plh: $el.children('.placeholder'),
      };
    },
    fixStyles: function (div, plh) {
      setTimeout(function () {
        plh.html(div.html());
        var pad = div[0].offsetWidth - div[0].clientWidth + 2;
        plh.css('padding-right', pad + 'px');
      });
    },
  });
});
