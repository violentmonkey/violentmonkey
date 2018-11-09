import {
  checkAuthUrl, initialize, sync, getStates, authorize, revoke,
} from './base';
import './dropbox';
import './onedrive';
import './googledrive';

browser.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url && checkAuthUrl(changes.url)) browser.tabs.remove(tabId);
});

export {
  initialize,
  sync,
  getStates,
  authorize,
  revoke,
};
