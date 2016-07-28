define('views/Main', function (require, _exports, module) {
  var MainTab = require('views/TabInstalled');
  var SettingsTab = require('views/TabSettings');
  var AboutTab = require('views/TabAbout');
  var cache = require('cache');

  var components = {
    main: MainTab,
    settings: SettingsTab,
    about: AboutTab,
  };

  module.exports = {
    props: {
      params: {
        coerce: function (params) {
          params.tab = components[params.tab] ? params.tab : 'main';
          return params;
        },
      },
    },
    template: cache.get('/options/components/main.html'),
    components: components,
    computed: {
      tab: function () {
        return this.params.tab;
      },
    },
  };
});
