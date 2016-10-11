function wrapHandler(name) {
  return function () {
    var _this = this;
    var options = _this.options;
    var handler = options[name];
    handler && handler.call(_this, options);
  };
}

var cache = require('../../cache');

module.exports = {
  props: ['options'],
  template: cache.get('./item.html'),
  data: function () {
    // make options reactive
    return {
      reactiveOptions: this.options,
    };
  },
  methods: {
    onClick: wrapHandler('onClick'),
    detailClick: wrapHandler('detailClick'),
  },
  mounted: wrapHandler('init'),
};
