var cache = require('src/cache');
var data = {
  version: browser.runtime.getManifest().version,
  language: navigator.language,
};

module.exports = {
  template: cache.get('./tab-about.html'),
  data: function () {
    return data;
  },
};
