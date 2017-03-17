var base = require('./base');

browser.tabs.onUpdated.addListener(function (tabId, changes) {
  changes.url && base.checkAuthUrl(changes.url) && browser.tabs.remove(tabId);
});

// import sync modules
require('./dropbox');
require('./onedrive');

module.exports = {
  initialize: base.initialize,
  sync: base.sync,
  states: base.getStates,
  service: base.getService,
  authorize: base.authorize,
  revoke: base.revoke,
};
