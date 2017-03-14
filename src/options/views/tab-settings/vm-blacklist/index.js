var _ = require('src/common');
var cache = require('src/cache');
var Message = require('src/options/views/message');

module.exports = {
  template: cache.get('./index.html'),
  data: function () {
    var rules = _.options.get('blacklist') || [];
    return {
      rules: rules.join('\n'),
    };
  },
  methods: {
    onSave: function () {
      var rules = this.rules.split('\n')
      .map(function (item) {return item.trim();})
      .filter(Boolean);
      _.options.set('blacklist', rules);
      Message.open({
        text: _.i18n('msgSavedBlacklist'),
      });
      _.sendMessage({cmd: 'BlacklistReset'});
    },
  },
};
