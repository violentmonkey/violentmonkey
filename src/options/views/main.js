var MainTab = require('./tab-installed');
var SettingsTab = require('./tab-settings');
var AboutTab = require('./tab-about');
var cache = require('../../cache');

var components = {
  Main: MainTab,
  Settings: SettingsTab,
  About: AboutTab,
};

module.exports = {
  props: ['params'],
  template: cache.get('./main.html'),
  components: components,
  computed: {
    tab: function () {
      var tab = this.params.tab;
      if (!components[tab]) tab = 'Main';
      return tab;
    },
  },
};
