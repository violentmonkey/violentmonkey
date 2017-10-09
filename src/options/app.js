import 'src/common/browser';
import 'src/common/sprite';
import Vue from 'vue';
import { sendMessage, i18n, getLocaleString } from 'src/common';
import options from 'src/common/options';
import getPathInfo from 'src/common/pathinfo';
import handlers from 'src/common/handlers';
import 'src/common/ui/style';
import { store } from './utils';
import App from './views/app';

Vue.prototype.i18n = i18n;

Object.assign(store, {
  loading: false,
  cache: {},
  scripts: [],
  sync: [],
  filteredScripts: [],
  route: null,
});
zip.workerScriptsPath = '/public/lib/zip.js/';
initialize();

function loadHash() {
  store.route = getPathInfo();
}

function initialize() {
  document.title = i18n('extName');
  window.addEventListener('hashchange', loadHash, false);
  loadHash();
  initMain();
  options.ready(() => {
    new Vue({
      render: h => h(App),
    }).$mount('#app');
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
  ].filter(Boolean).join('\n').toLowerCase();
  const name = script.custom.name || localeName;
  const lowerName = name.toLowerCase();
  script._cache = { search, name, lowerName };
}

function loadData() {
  sendMessage({ cmd: 'GetData' })
  .then(data => {
    [
      'cache',
      'scripts',
      'sync',
    ].forEach(key => {
      Vue.set(store, key, data[key]);
    });
    if (store.scripts) {
      store.scripts.forEach(initScript);
    }
    store.loading = false;
  });
}

function initMain() {
  store.loading = true;
  loadData();
  Object.assign(handlers, {
    ScriptsUpdated: loadData,
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
        Vue.set(store.scripts, index, updated);
        initScript(updated);
      }
    },
  });
}
