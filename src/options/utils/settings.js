define('utils/settings', function () {
  Vue.directive('setting', {
    bind: function () {
      var _this = this;
      _this.onChange = function () {
        _.options.set(_this.value, _this.el.checked);
      };
      _this.el.addEventListener('change', _this.onChange, false);
    },
    update: function (value) {
      var _this = this;
      _this.el.checked = _.options.get(_this.value = value);
    },
    unbind: function () {
      var _this = this;
      _this.el.removeEventListener('change', _this.onChange, false);
    },
  });
});
