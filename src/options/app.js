function initMain() {
  store.loading = true;
  _.sendMessage({cmd: 'GetData'})
  .then(function (data) {
    [
      'cache',
      'scripts',
      'sync',
    ].forEach(function (key) {
      Vue.set(store, key, data[key]);
    });
    store.loading = false;
    // utils.features.reset(data.version);
    utils.features.reset('sync');
  });
  Object.assign(handlers, {
    UpdateSync: function (data) {
      store.sync = data;
    },
    AddScript: function (data) {
      data.message = '';
      store.scripts.push(data);
    },
    UpdateScript: function (data) {
      if (!data) return;
      var script = store.scripts.find(function (script) {
        return script.id === data.id;
      });
      script && Object.keys(data).forEach(function (key) {
        Vue.set(script, key, data[key]);
      });
    },
    RemoveScript: function (data) {
      var i = store.scripts.findIndex(function (script) {
        return script.id === data;
      });
      ~i && store.scripts.splice(i, 1);
    },
  });
}
function parseLocation(pathInfo) {
  var parts = pathInfo.split('?');
  var path = parts[0];
  var query = (parts[1] || '').split('&').reduce(function (res, seq) {
    if (seq) {
      var parts = seq.split('=');
      res[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
    }
    return res;
  }, {});
  return {path: path, query: query};
}
function loadHash() {
  var loc = parseLocation(location.hash.slice(1));
  var route = routes[loc.path];
  if (route) {
    hashData.type = route.key;
    hashData.params = loc.query;
    if (route.init) {
      route.init();
      route.init = null;
    }
  } else {
    location.hash = '';
  }
}
function initCustomCSS() {
  var style;
  _.options.hook(function (changes) {
    var customCSS = changes.customCSS || '';
    if (customCSS && !style) {
      style = document.createElement('style');
      document.head.appendChild(style);
    }
    if (customCSS || style) {
      style.innerHTML = customCSS;
    }
  });
}

var _ = require('../common');
_.initOptions();
var utils = require('./utils');
var Main = require('./views/main');
var Confirm = require('./views/confirm');

var store = Object.assign(utils.store, {
  loading: false,
  cache: {},
  scripts: [],
  sync: [],
});
var routes = {
  '': {
    key: 'Main',
    init: initMain,
  },
  confirm: {
    key: 'Confirm',
  },
};
var hashData = {
  type: null,
  params: null,
};
var handlers = {
  UpdateOptions: function (data) {
    _.options.update(data);
  },
};
browser.runtime.onMessage.addListener(function (res) {
  var handle = handlers[res.cmd];
  handle && handle(res.data);
});
window.addEventListener('hashchange', loadHash, false);
zip.workerScriptsPath = '/public/lib/zip.js/';
document.title = _.i18n('extName');
loadHash();
initCustomCSS();

_.options.ready.then(function () {
  new Vue({
    el: '#app',
    template: '<component :is=type :params=params></component>',
    components: {
      Main: Main,
      Confirm: Confirm,
    },
    data: hashData,
  });
});
