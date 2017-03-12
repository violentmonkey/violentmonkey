var _ = require('src/common');

var hooks = {};
_.options.hook(function (data) {
  Object.keys(data).forEach(function (key) {
    var list = hooks[key];
    list && list.forEach(function (el) {
      el.checked = data[key];
    });
  });
});

function onSettingChange(e) {
  var target = e.target;
  _.options.set(target.dataset.setting, target.checked);
}

Vue.directive('setting', {
  bind: function (el, binding) {
    var value = binding.value;
    el.dataset.setting = value;
    el.addEventListener('change', onSettingChange, false);
    var list = hooks[value] = hooks[value] || [];
    list.push(el);
    el.checked = _.options.get(value);
  },
  unbind: function (el, binding) {
    var value = binding.value;
    el.removeEventListener('change', onSettingChange, false);
    var list = hooks[value] || [];
    var i = list.indexOf(el);
    ~i && list.splice(i, 1);
  },
});
