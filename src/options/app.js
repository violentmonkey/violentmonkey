import Vue from 'vue';
import 'src/common/sprite';
import { sendMessage, i18n } from 'src/common';
import options from 'src/common/options';
import { store, features } from './utils';
import App from './views/app';

Vue.prototype.i18n = i18n;

Object.assign(store, {
  loading: false,
  cache: {},
  scripts: [],
  sync: [],
  route: null,
});
const handlers = {
  UpdateOptions(data) {
    options.update(data);
  },
};
browser.runtime.onMessage.addListener((res) => {
  const handle = handlers[res.cmd];
  if (handle) handle(res.data);
});
zip.workerScriptsPath = '/public/lib/zip.js/';
document.title = i18n('extName');
initCustomCSS();

const routes = {
  '': {
    comp: 'Main',
    init: initMain,
  },
  confirm: {
    comp: 'Confirm',
  },
};
window.addEventListener('hashchange', loadHash, false);
loadHash();

options.ready(() => new Vue({
  el: '#app',
  render: h => h(App),
}));

function parseLocation(pathInfo) {
  const [path, qs] = pathInfo.split('?');
  const query = (qs || '').split('&').reduce((res, seq) => {
    if (seq) {
      const [key, val] = seq.split('=');
      res[decodeURIComponent(key)] = decodeURIComponent(val);
    }
    return res;
  }, {});
  return { path, query };
}
function loadHash() {
  const loc = parseLocation(location.hash.slice(1));
  const route = routes[loc.path];
  if (route) {
    store.route = {
      comp: route.comp,
      query: loc.query,
    };
    if (route.init) {
      route.init();
      route.init = null;
    }
  } else {
    location.hash = '';
  }
}

function initMain() {
  store.loading = true;
  sendMessage({ cmd: 'GetData' })
  .then((data) => {
    [
      'cache',
      'scripts',
      'sync',
    ].forEach((key) => {
      Vue.set(store, key, data[key]);
    });
    store.loading = false;
    // features.reset(data.version);
    features.reset('sync');
  });
  Object.assign(handlers, {
    UpdateSync(data) {
      store.sync = data;
    },
    AddScript(data) {
      data.message = '';
      store.scripts.push(data);
    },
    UpdateScript(data) {
      if (!data) return;
      const script = store.scripts.find(item => item.id === data.id);
      if (script) {
        Object.keys(data).forEach((key) => {
          Vue.set(script, key, data[key]);
        });
      }
    },
    RemoveScript(data) {
      const i = store.scripts.findIndex(script => script.id === data);
      if (i >= 0) store.scripts.splice(i, 1);
    },
  });
}
function initCustomCSS() {
  let style;
  options.hook((changes) => {
    const customCSS = changes.customCSS || '';
    if (customCSS && !style) {
      style = document.createElement('style');
      document.head.appendChild(style);
    }
    if (customCSS || style) {
      style.textContent = customCSS;
    }
  });
}
