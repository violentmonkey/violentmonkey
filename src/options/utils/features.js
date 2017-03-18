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
var items = {};

exports.reset = function (version) {
  if (features.version !== version) {
    _.options.set(key, features = {
      version: version,
      data: {},
    });
  }
};

function getContext(el, value) {
  function onFeatureClick(_e) {
    features.data[value] = 1;
    _.options.set(key, features);
    el.classList.remove('feature');
    el.removeEventListener('click', onFeatureClick, false);
  }
  function clear() {
    el.removeEventListener('click', onFeatureClick, false);
  }
  function reset() {
    clear();
    if (!features.version || features.data[value]) return;
    el.classList.add('feature');
    el.addEventListener('click', onFeatureClick, false);
  }
  return {
    el: el,
    reset: reset,
    clear: clear,
  };
}

Vue.directive('feature', {
  bind: function (el, binding) {
    var value = binding.value;
    var item = getContext(el, value);
    var list = items[value] = items[value] || [];
    list.push(item);
    item.reset();
    hooks && hooks.hook(item.reset);
  },
  unbind: function (el, binding) {
    var list = items[binding.value];
    if (list) {
      var index = list.findIndex(function (item) {
        return item.el === el;
      });
      if (~index) {
        list[index].clear();
        list.splice(index, 1);
      }
    }
  },
});
