define('views/Domain', function (require, _exports, module) {
  var app = require('app');
  var MixIn = require('views/MixIn');
  var _ = require('utils/common');

  module.exports = {
    mixins: [MixIn],
    ready: function () {
      this.items.top.push({
        name: _.i18n('menuBack'),
        symbol: 'arrow-left',
        onClick: function () {
          app.navigate('');
        },
      });
    },
    watch: {
      'store.domains': 'update',
    },
    methods: {
      updateView: function () {
        var _this = this;
        _this.items.bot = _this.store.domains.map(function (domain) {
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
  };
});
