var _ = require('../../common');

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
  bind: function (el, binding) {
    function onFeatureClick(_e) {
      features.data[value] = 1;
      _.options.set(key, features);
      el.classList.remove('feature');
      el.removeEventListener('click', onFeatureClick, false);
    }
    var value = binding.value;
    if (features.data[value]) return;
    el.classList.add('feature');
    el.addEventListener('click', onFeatureClick, false);
  },
});
