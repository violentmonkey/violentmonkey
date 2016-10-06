var cache = require('../../cache');
var data = {
  version: chrome.app.getDetails().version,
  language: navigator.language,
};

module.exports = {
  template: cache.get('./tab-about.html'),
  data: function () {
    return data;
  },
};
