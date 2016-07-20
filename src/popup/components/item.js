define('views/MenuItem', function (require, _exports, module) {
  function wrapHandler(name) {
    return function () {
      var _this = this;
      var options = _this.options;
      var handler = options[name];
      handler && handler.call(_this, options);
    };
  }

  var cache = require('cache');

  module.exports = {
    props: ['options'],
    template: cache.get('/popup/components/menuitem.html'),
    methods: {
      onClick: wrapHandler('onClick'),
      detailClick: wrapHandler('detailClick'),
    },
    ready: wrapHandler('init'),
  };
});
