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
  var port = chrome.runtime.connect({name: 'Options'});
  port.onMessage.addListener(function (res) {
    switch (res.cmd) {
    case 'sync':
      store.sync = res.data;
      break;
    case 'add':
      res.data.message = '';
      store.scripts.push(res.data);
      break;
    case 'update':
      if (res.data) {
        var script = store.scripts.find(function (script) {
          return script.id === res.data.id;
        });
        script && Object.keys(script).forEach(function (key) {
          Vue.set(script, key, res.data[key]);
        });
      }
      break;
    case 'del':
      var i = store.scripts.findIndex(function (script) {
        return script.id === res.data;
      });
      ~i && store.scripts.splice(i, 1);
    }
  });
}
function loadHash() {
  var hash = location.hash.slice(1);
  Object.keys(routes).find(function (key) {
    var test = routes[key];
    var params = test(hash);
    if (params) {
      hashData.type = key;
      hashData.params = params;
      if (init[key]) {
        init[key]();
        init[key] = null;
      }
      return true;
    }
  });
}

var _ = require('../common');
var utils = require('./utils');
var Main = require('./views/main');
var Confirm = require('./views/confirm');

var store = Object.assign(utils.store, {
  loading: false,
  cache: {},
  scripts: [],
  sync: [],
});
var init = {
  Main: initMain,
};
var routes = {
  Main: utils.routeTester([
    '',
    'main/:tab',
  ]),
  Confirm: utils.routeTester([
    'confirm/:url',
    'confirm/:url/:referer',
  ]),
};
var hashData = {
  type: null,
  params: null,
};
window.addEventListener('hashchange', loadHash, false);
loadHash();
zip.workerScriptsPath = '/lib/zip.js/';
document.title = _.i18n('extName');

new Vue({
  el: '#app',
  template: '<component :is=type :params=params></component>',
  components: {
    Main: Main,
    Confirm: Confirm,
  },
  data: hashData,
});
