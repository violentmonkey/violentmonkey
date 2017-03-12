var tabs = require('../utils/tabs');
var base = require('./base');

tabs.update(function (tab) {
  tab.url && base.checkAuthUrl(tab.url) && tabs.remove(tab.id);
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
