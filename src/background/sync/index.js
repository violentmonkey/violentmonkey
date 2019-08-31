import {
  checkAuthUrl,
  initialize,
  sync,
  getStates,
  authorize,
  revoke,
  setConfig,
} from './base';
import './dropbox';
import './onedrive';
import './googledrive';
import './webdav';

browser.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url && checkAuthUrl(changes.url)) browser.tabs.remove(tabId);
});

export {
  initialize,
  sync,
  getStates,
  authorize,
  revoke,
  setConfig,
};
