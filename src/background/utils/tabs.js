define('utils/tabs', function (_require, _exports, module) {
  module.exports = {
    create: function (url) {
      chrome.tabs.create({url: url});
    },
    update: function (cb) {
      chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, _tab) {
        cb({
          id: tabId,
          url: changeInfo.url,
        });
      });
    },
    remove: function (id) {
      chrome.tabs.remove(id);
    },
    get: function (id) {
      return new Promise(function (resolve, _reject) {
        chrome.tabs.get(id, function (tab) {
          resolve(tab);
        });
      });
    },
    broadcast: function (data) {
      chrome.tabs.query({}, function (tabs) {
        tabs.forEach(function (tab) {
          chrome.tabs.sendMessage(tab.id, data);
        });
      });
    },
  };
});
