var _ = require('src/common');
var cache = require('src/cache');
var Message = require('src/options/views/message');

module.exports = {
  template: cache.get('./index.html'),
  data: function () {
    return {
      css: _.options.get('customCSS'),
    };
  },
  methods: {
    onSave: function () {
      _.options.set('customCSS', (this.css || '').trim());
      Message.open({
        text: _.i18n('msgSavedCustomCSS'),
      });
    },
  },
};
