define('utils/features', function (require, exports, _module) {
  var _ = require('utils/common');

  var key = 'features';
  var features = _.options.get(key);
  if (!features || !features.data) features = {
    data: {},
  };

  exports.reset = function (version) {
    if (features.version !== version) {
      _.options.set(key, features = {
        version: version,
        data: {},
      });
    }
  };

  Vue.directive('feature', {
    bind: function () {
      function onClick() {
        features.data[_this.value] = 1;
        _.options.set(key, features);
        _this.hideFeature();
      }

      var _this = this;
      var el = _this.el;
      var bound = false;
      _this.showFeature = function () {
        if (bound) return;
        bound = true;
        el.classList.add('feature');
        el.addEventListener('click', onClick, false);
      };
      _this.hideFeature = function () {
        if (!bound) return;
        bound = false;
        el.classList.remove('feature');
        el.removeEventListener('click', onClick, false);
      };
    },
    update: function (value) {
      var _this = this;
      if (features.data[_this.value = value]) {
        _this.hideFeature();
      } else {
        _this.showFeature();
      }
    },
    unbind: function () {
      this.hideFeature();
    },
  });
});
