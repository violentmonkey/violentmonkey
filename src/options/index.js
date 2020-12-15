import Vue from 'vue';
import { sendCmdDirectly, i18n, getLocaleString } from '#/common';
import { forEachEntry } from '#/common/object';
import handlers from '#/common/handlers';
import options from '#/common/options';
import ua from '#/common/ua';
import loadZip from '#/common/zip';
import '#/common/ui/style';
import { store } from './utils';
import App from './views/app';

Vue.prototype.i18n = i18n;

Object.assign(store, {
  loading: false,
  cache: {},
  scripts: [],
  sync: [],
  title: null,
});
initialize();

function initialize() {
  initMain();
  store.HiDPI = matchMedia('screen and (min-resolution: 144dpi)').matches;
  if (ua.isFirefox) { // Firefox doesn't show favicon
    const icons = browser.runtime.getManifest().browser_action.default_icon;
    const el = document.createElement('link');
    el.rel = 'icon';
    el.href = icons[store.HiDPI ? 32 : 16];
    document.head.appendChild(el);
  }
  const vm = new Vue({
    render: h => h(App),
  })
  .$mount();
  document.body.append(vm.$el);
  loadZip()
  .then((zip) => {
    store.zip = zip;
    zip.workerScriptsPath = '/public/lib/zip.js/';
  });
}

function initScript(script) {
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
  script.$cache = { search, name, lowerName };
}

export async function loadData() {
  const id = store.route.paths[1];
  const params = id ? [+id].filter(Boolean) : null;
  const [{ cache, scripts, sync }] = await Promise.all([
    sendCmdDirectly('GetData', params, { retry: true }),
    options.ready,
  ]);
  if (cache) {
    const oldCache = store.cache || {};
    cache::forEachEntry(([url, raw]) => {
      const res = oldCache[url] || raw && `data:image/png;base64,${raw.split(',').pop()}`;
      if (res) cache[url] = res;
    });
  }
  scripts?.forEach(initScript);
  store.scripts = scripts;
  store.cache = cache;
  store.sync = sync;
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
    AddScript({ update }) {
      update.message = '';
      initScript(update);
      store.scripts.push(update);
    },
    UpdateScript(data) {
      if (!data) return;
      const index = store.scripts.findIndex(item => item.props.id === data.where.id);
      if (index >= 0) {
        const updated = Object.assign({}, store.scripts[index], data.update);
        if (updated.error && !data.update.error) updated.error = null;
        Vue.set(store.scripts, index, updated);
        initScript(updated);
      }
    },
    RemoveScript(id) {
      const i = store.scripts.findIndex(script => script.props.id === id);
      if (i >= 0) store.scripts.splice(i, 1);
    },
  });
}
