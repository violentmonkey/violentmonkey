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
    return {
      data: {},
    };
  },
  watch: {
    options: 'update',
  },
  methods: {
    update: function () {
      this.data = this.options;
      this.init();
    },
    init: wrapHandler('init'),
    onClick: wrapHandler('onClick'),
    detailClick: wrapHandler('detailClick'),
  },
  mounted: function () {
    this.update();
  },
};
