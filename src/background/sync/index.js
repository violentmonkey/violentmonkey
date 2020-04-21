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
import { commands } from '../utils/message';

Object.assign(commands, {
  SyncAuthorize: authorize,
  SyncRevoke: revoke,
  SyncStart: sync,
  SyncSetConfig: setConfig,
});

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
