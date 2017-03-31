import Vue from 'vue';
import options from 'src/common/options';

const hooks = {};
options.hook((data) => {
  Object.keys(data).forEach((key) => {
    const list = hooks[key];
    if (list) list.forEach((el) => { el.checked = data[key]; });
  });
});

function onSettingChange(e) {
  const { target } = e;
  options.set(target.dataset.setting, target.checked);
}

Vue.directive('setting', {
  bind(el, binding) {
    const { value } = binding;
    el.dataset.setting = value;
    el.addEventListener('change', onSettingChange, false);
    let list = hooks[value];
    if (!list) {
      list = [];
      hooks[value] = list;
    }
    list.push(el);
    el.checked = options.get(value);
  },
  unbind(el, binding) {
    const { value } = binding;
    el.removeEventListener('change', onSettingChange, false);
    const list = hooks[value] || [];
    const i = list.indexOf(el);
    if (i >= 0) list.splice(i, 1);
  },
});
