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
      return _this.store.domains.map(function (domain) {
        return {
          name: domain,
          className: 'ellipsis',
          onClick: function () {
            chrome.tabs.create({
              url: 'https://greasyfork.org/scripts/search?q=' + encodeURIComponent(domain),
            });
          },
        };
      });
    },
  },
  watch: {
    'store.domains': 'fixStyles',
  },
};
