var MenuItem = require('./item');
var cache = require('../../cache');
var utils = require('../utils');

module.exports = {
  template: cache.get('./menu.html'),
  data: function () {
    return {
      store: utils.store,
    };
  },
  components: {
    MenuItem: MenuItem,
  },
  mounted: function () {
    this.fixStyles();
  },
  methods: {
    fixStyles: function () {
      var _this = this;
      _this.$nextTick(function () {
        var placeholder = _this.$refs.placeholder;
        var bot = _this.$refs.bot;
        placeholder.innerHTML = bot.innerHTML;
        var pad = bot.offsetWidth - bot.clientWidth + 2;
        placeholder.style.paddingRight = pad + 'px';
      });
    },
    isVisible: function (item) {
      var hide = item.hide;
      if (typeof hide === 'function') hide = hide.call(this);
      return !hide;
    },
  },
};
