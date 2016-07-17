define('views/Message', function (require, _exports, module) {
  var cache = require('cache');

  module.exports = Vue.extend({
    template: cache.get('/options/components/message.html'),
    el: function () {
      var el = document.createElement('div');
      document.body.appendChild(el);
      return el;
    },
    ready: function () {
      var _this = this;
      new Promise(function (resolve) {
        setTimeout(resolve, 2000);
      })
      .then(function () {
        _this.$destroy(true);
      });
    },
  });
});
