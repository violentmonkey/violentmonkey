import Vue from 'vue';
import { initHooks } from 'src/common';
import options from 'src/common/options';

const FEATURES = 'features';
let features = options.get(FEATURES);
let hooks = initHooks();
let revoke = options.hook((data) => {
  if (data[FEATURES]) {
    features = data[FEATURES];
    revoke();
    revoke = null;
    hooks.fire();
    hooks = null;
  }
});
if (!features || !features.data) {
  features = {
    data: {},
  };
}
const items = {};

export default function resetFeatures(version) {
  if (features.version !== version) {
    options.set(FEATURES, features = {
      version,
      data: {},
    });
  }
}

function getContext(el, value) {
  function onFeatureClick() {
    features.data[value] = 1;
    options.set(FEATURES, features);
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
    el,
    clear,
    reset,
  };
}

Vue.directive('feature', {
  bind(el, binding) {
    const { value } = binding;
    const item = getContext(el, value);
    let list = items[value];
    if (!list) {
      list = [];
      items[value] = list;
    }
    list.push(item);
    item.reset();
    if (hooks) hooks.hook(item.reset);
  },
  unbind(el, binding) {
    const list = items[binding.value];
    if (list) {
      const index = list.findIndex(item => item.el === el);
      if (index >= 0) {
        list[index].clear();
        list.splice(index, 1);
      }
    }
  },
});
