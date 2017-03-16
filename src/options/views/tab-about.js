var cache = require('../../cache');
var data = {
  version: chrome.runtime.getManifest().version,
  language: navigator.language,
};

module.exports = {
  template: cache.get('./tab-about.html'),
  data: function () {
    return data;
  },
};
