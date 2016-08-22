define('app', function (require, _exports, _module) {
  function initMain() {
    store.loading = true;
    _.sendMessage({cmd: 'GetData'})
    .then(function (data) {
      [
        'cache',
        'scripts',
        'sync',
      ].forEach(function (key) {
        store[key] = data[key];
      });
      store.loading = false;
      // features.reset(data.version);
      features.reset('sync');
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
          if (script) for (var k in res.data) {
            Vue.set(script, k, res.data[k]);
          }
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

  var _ = require('utils/common');
  var utils = require('utils');
  var Main = require('views/Main');
  var Confirm = require('views/Confirm');
  var features = require('utils/features');
  var store = Object.assign(utils.store, {
    loading: false,
    cache: {},
    scripts: [],
    sync: [],
  });
  var init = {
    Main: initMain,
  };
  zip.workerScriptsPath = '/lib/zip.js/';
  document.title = _.i18n('extName');

  new Vue({
    el: document.body,
    components: {
      Main: Main,
      Confirm: Confirm,
    },
    data: function () {
      return {
        type: 'main',
        params: {},
      };
    },
    ready: function () {
      var _this = this;
      _this.routes = {
        Main: utils.routeTester([
          '',
          'main/:tab',
        ]),
        Confirm: utils.routeTester([
          'confirm/:url',
          'confirm/:url/:referer',
        ]),
      };
      window.addEventListener('hashchange', _this.loadHash.bind(_this));
      _this.loadHash();
    },
    methods: {
      loadHash: function () {
        var _this = this;
        var hash = location.hash.slice(1);
        for (var k in _this.routes) {
          var test = _this.routes[k];
          var params = test(hash);
          if (params) {
            _this.type = k;
            _this.params = params;
            if (init[k]) {
              init[k]();
              init[k] = null;
            }
            break;
          }
        }
      },
    },
  });
});
