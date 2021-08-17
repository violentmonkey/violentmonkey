import Vue from 'vue';
import '#/common/browser';
import { sendCmdDirectly, i18n, getLocaleString } from '#/common';
import handlers from '#/common/handlers';
import { loadScriptIcon } from '#/common/load-script-icon';
import options from '#/common/options';
import '#/common/ui/style';
import { store } from './utils';
import App from './views/app';

Vue.prototype.i18n = i18n;

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
  script.$cache = { search, name, lowerName };
  if (!await loadScriptIcon(script, store.cache)) {
    script.safeIcon = `/public/images/icon${
      store.HiDPI ? 128 : script.config.removed && 32 || 38
    }.png`;
  }
}

export async function loadData() {
  const id = store.route.paths[1];
  const params = id ? [+id].filter(Boolean) : null;
  const [{ cache, scripts, sync }] = await Promise.all([
    sendCmdDirectly('GetData', params, { retry: true }),
    options.ready,
  ]);
  store.cache = cache;
  scripts?.forEach(initScript);
  store.scripts = scripts;
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
