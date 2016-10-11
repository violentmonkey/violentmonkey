var app = require('../app');
var MixIn = require('./mixin');
var _ = require('../../common');

module.exports = {
  mixins: [MixIn],
  data: function () {
    return {
      top: [{
        name: _.i18n('menuBack'),
        symbol: 'arrow-left',
        onClick: function () {
          app.navigate();
        },
      }],
    };
  },
  computed: {
    bot: function () {
      var _this = this;
      return _this.store.commands.map(function (item) {
        return {
          name: item[0],
          symbol: 'right-hand',
          className: 'ellipsis',
          onClick: function (options) {
            chrome.tabs.sendMessage(_this.store.currentTab.id, {
              cmd: 'Command',
              data: options.name,
            });
          },
        };
      });
    },
  },
  watch: {
    'store.commands': 'fixStyles',
  },
};
