define('views/MixIn', function (require, _exports, module) {
  var MenuItem = require('views/MenuItem');
  var cache = require('cache');
  var utils = require('utils');

  module.exports = {
    template: cache.get('/popup/components/menu.html'),
    data: function () {
      return {
        items: {
          top: [],
          bot: [],
        },
        store: utils.store,
      };
    },
    components: {
      MenuItem: MenuItem,
    },
    ready: function () {
      this.update();
      utils.fixStyles(this);
    },
  };
});
