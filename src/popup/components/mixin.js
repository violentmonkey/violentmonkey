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
    },
    methods: {
      update: function () {
        var _this = this;
        _this.updateView();
        _this.fixStyles();
      },
      fixStyles: function () {
        var _this = this;
        _this.$nextTick(function () {
          var placeholder = _this.$els.placeholder;
          var bot = _this.$els.bot;
          placeholder.innerHTML = bot.innerHTML;
          var pad = bot.offsetWidth - bot.clientWidth + 2;
          placeholder.style.paddingRight = pad + 'px';
        });
      },
    },
  };
});
