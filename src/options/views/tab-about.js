define('views/TabAbout', function (require, _exports, module) {
  var BaseView = require('cache').BaseView;
  module.exports = BaseView.extend({
    el: '#tab',
    name: 'about',
    templateUrl: '/options/templates/tab-about.html',
    _render: function () {
      this.$el.html(this.templateFn({
        version: chrome.app.getDetails().version,
      }));
    },
  });
});
