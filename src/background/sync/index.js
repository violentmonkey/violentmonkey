import {
  checkAuthUrl, initialize, sync, getStates, authorize, revoke,
} from './base';

browser.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url && checkAuthUrl(changes.url)) browser.tabs.remove(tabId);
});

// import sync modules
require('./dropbox');
require('./onedrive');

export {
  initialize,
  sync,
  getStates,
  authorize,
  revoke,
};
