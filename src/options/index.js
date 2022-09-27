import Vue from 'vue';
import '@/common/browser';
import { formatByteLength, getLocaleString, i18n, sendCmdDirectly, trueJoin } from '@/common';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import options from '@/common/options';
import '@/common/ui/style';
import { store } from './utils';
import App from './views/app';

const SIZE_TITLES = {
  c: i18n('editNavCode'),
  i: i18n('editNavSettings'),
  v: i18n('editNavValues'),
};

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
 */
async function initScript(script) {
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
  script.$cache = { search, name, lowerName, size: '', sizes: '', sizeNum: 0 };
  if (!await loadScriptIcon(script, store.cache)) {
    script.safeIcon = `/public/images/icon${
      store.HiDPI ? 128 : script.config.removed && 32 || 38
    }.png`;
  }
}

/**
 * @param {VMScriptSizeInfo} sz
 * @param {VMScript} script
 */
function initSize(sz, { $cache }) {
  let total = 0;
  $cache.sizes = Object.entries(sz).map(([key, val]) => {
    total += val;
    return val && `${
      SIZE_TITLES[key] || key
    }: ${
      formatByteLength(val).replace(/[^B]$/, '$&B')
    }.`.replace(/\s/g, '\xA0');
  })::trueJoin(' ');
  $cache.sizeNum = total;
  $cache.size = formatByteLength(total, true).replace(' ', '');
}

/**
 * @param {VMScript} script
 */
async function initScriptAndSize(script) {
  const res = initScript(script);
  const [sz] = await sendCmdDirectly('GetSizes', [script.props.id]);
  initSize(sz, script);
  return res;
}

export function loadData() {
  const id = +store.route.paths[1];
  return requestData(id ? [id] : null)
  .catch(id ? (() => requestData()) : console.error);
}

async function requestData(ids) {
  const getDataP = sendCmdDirectly('GetData', ids, { retry: true });
  const getSizesP = sendCmdDirectly('GetSizes', ids, { retry: true });
  const [data] = await Promise.all([getDataP, options.ready]);
  const { scripts } = data;
  scripts.forEach(initScript);
  getSizesP.then(sizes => sizes.forEach((sz, i) => initSize(sz, scripts[i])));
  Object.assign(store, data);
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
      const { scripts } = store;
      const index = scripts.findIndex(item => item.props.id === where.id);
      const updated = Object.assign({}, scripts[index], update);
      if (updated.error && !update.error) updated.error = null;
      await initScriptAndSize(updated);
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
