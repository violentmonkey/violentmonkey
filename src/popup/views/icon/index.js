var cache = require('src/cache');

module.exports = {
  props: ['name'],
  template: cache.get('./index.html'),
  computed: {
    iconName: function () {
      return '#' + this.name;
    },
  },
};
