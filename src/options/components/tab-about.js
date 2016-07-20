define('views/TabAbout', function (require, _exports, module) {
  var cache = require('cache');
  var data = {
    version: chrome.app.getDetails().version,
    language: navigator.language,
  };

  module.exports = {
    template: cache.get('/options/components/tab-about.html'),
    data: function () {
      return data;
    },
  };
});
