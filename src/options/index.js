import Vue from 'vue';
import '@/common/browser';
import { formatByteLength, getLocaleString, i18n, sendCmdDirectly } from '@/common';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import options from '@/common/options';
import '@/common/ui/style';
import { store } from './utils';
import App from './views/app';

// Same order as getSizes and sizesPrefixRe
const SIZE_TITLES = [
  i18n('editNavCode'),
  i18n('editNavSettings'),
  i18n('editNavValues'),
  '@require',
  '@resource',
];

Object.assign(store, {
  loading: false,
  sync: [],
  title: null,
});
initialize();

function initialize() {
  initMain();
  const vm = new Vue({
    render: h => h(App),
  })
  .$mount();
  document.body.append(vm.$el);
}

/**
 * @param {VMScript} script
 * @param {number[]} sizes
 */
function initScript(script, sizes) {
  const meta = script.meta || {};
  const localeName = getLocaleString(meta, 'name');
  const search = [
    meta.name,
    localeName,
    meta.description,
    getLocaleString(meta, 'description'),
    script.custom.name,
    script.custom.description,
  ].filter(Boolean).join('\n');
  const name = script.custom.name || localeName;
  const lowerName = name.toLowerCase();
  let total = 0;
  let str = '';
  sizes.forEach((val, i) => {
    total += val;
    if (val) str += `${SIZE_TITLES[i]}: ${formatByteLength(val)}\n`;
  });
  script.$cache = {
    search,
    name,
    lowerName,
    size: formatByteLength(total, true).replace(' ', ''),
    sizes: str.slice(0, -1).replace(/\x20/g, '\xA0').replace(/[^B]$/gm, '$&B'),
    sizeNum: total,
  };
  loadScriptIcon(script, store.cache, store.HiDPI || -1);
}

export function loadData() {
  const id = +store.route.paths[1];
  return requestData(id ? [id] : null)
  .catch(id ? (() => requestData()) : console.error);
}

async function requestData(ids) {
  const [data] = await Promise.all([
    sendCmdDirectly('GetData', { ids, sizes: true }, { retry: true }),
    options.ready,
  ]);
  const { scripts, sizes, ...auxData } = data;
  Object.assign(store, auxData); // initScripts needs `cache` in store
  scripts.forEach((script, i) => { // modifying scripts without triggering reactivity
    initScript(script, sizes[i]);
  });
  store.scripts = scripts; // now we can render
  store.loading = false;
}

function initMain() {
  store.loading = true;
  loadData();
  Object.assign(handlers, {
    ScriptsUpdated() {
      loadData();
    },
    UpdateSync(data) {
      store.sync = data;
    },
    async UpdateScript({ update, where } = {}) {
      if (!update) return;
      const [sizes] = await sendCmdDirectly('GetSizes', [where.id]);
      const { scripts } = store;
      const index = scripts.findIndex(item => item.props.id === where.id);
      const updated = Object.assign({}, scripts[index], update);
      if (updated.error && !update.error) updated.error = null;
      initScript(updated, sizes);
      if (index < 0) {
        update.message = '';
        scripts.push(updated);
      } else {
        Vue.set(scripts, index, updated);
      }
    },
    RemoveScript(id) {
      const i = store.scripts.findIndex(script => script.props.id === id);
      if (i >= 0) store.scripts.splice(i, 1);
    },
  });
}
