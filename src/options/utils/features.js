var _ = require('src/common');

var key = 'features';
var hooks = _.initHooks();
var revoke = _.options.hook(function (data) {
  if (data[key]) {
    features = data[key];
    revoke();
    revoke = null;
    hooks.fire();
    hooks = null;
  }
});
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
  bind: function (el, binding) {
    function onFeatureClick(_e) {
      features.data[value] = 1;
      _.options.set(key, features);
      el.classList.remove('feature');
      el.removeEventListener('click', onFeatureClick, false);
    }
    function reset() {
      if (!features.version || features.data[value]) return;
      el.classList.add('feature');
      el.removeEventListener('click', onFeatureClick, false);
      el.addEventListener('click', onFeatureClick, false);
    }
    var value = binding.value;
    reset();
    hooks && hooks.hook(reset);
  },
});
