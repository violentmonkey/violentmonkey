import Vue from 'vue';
import '@/common/browser';
import { formatByteLength, getLocaleString, i18n, makePause, sendCmdDirectly } from '@/common';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import options from '@/common/options';
import '@/common/ui/style';
import { store } from './utils';
import App from './views/app';

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
  loadScriptIcon(script, store.cache, store.HiDPI || -1);
}

/**
 * @param {number[]} sz
 * @param {VMScript} script
 */
function initSize(sz, { $cache }) {
  let total = 0;
  let str = '';
  for (let i = 0, val; i < sz.length; i += 1) {
    val = sz[i];
    total += val;
    if (val) str += `${SIZE_TITLES[i]}: ${formatByteLength(val)}\n`;
  }
  $cache.sizes = str.slice(0, -1).replace(/\x20/g, '\xA0').replace(/[^B]$/gm, '$&B');
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
  const [data] = await Promise.all([getDataP, options.ready]);
  const { scripts, ...auxData } = data;
  const getSizesP = sendCmdDirectly('GetSizes', ids, { retry: true })
  .then(sizes => sizes.forEach((sz, i) => initSize(sz, scripts[i])));
  Object.assign(store, auxData); // initScripts needs `cache` in store
  scripts.forEach(initScript); // modifying scripts without triggering reactivity
  await Promise.race([makePause(0), getSizesP]); // blocking render for one event loop tick
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
