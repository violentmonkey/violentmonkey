define('utils/settings', function (require, _exports, _module) {
  var _ = require('utils/common');

  Vue.directive('setting', {
    bind: function () {
      var _this = this;
      _this.onChange = function () {
        _.options.set(_this.value, _this.el.checked);
      };
      _this.onSet = function (key, value) {
        if (key === _this.value) {
          _this.el.checked = value;
        }
      };
      _this.el.addEventListener('change', _this.onChange, false);
      _.options.hook(_this.onSet);
    },
    update: function (value) {
      var _this = this;
      _this.el.checked = _.options.get(_this.value = value);
    },
    unbind: function () {
      var _this = this;
      _this.el.removeEventListener('change', _this.onChange, false);
      _.options.unhook(_this.onSet);
    },
  });
});
