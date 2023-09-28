import {
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
import { addOwnCommands, hookOptionsInit } from '../utils';
import { S_CODE_PRE, S_SCRIPT_PRE } from '../utils/storage';
import { onStorageChanged } from '../utils/storage-cache';

const keysToSyncRe = new RegExp(`^(?:${[
  S_SCRIPT_PRE,
  S_CODE_PRE,
].join('|')})`);
let unwatch;

hookOptionsInit((changes, firstRun) => {
  if ('sync.current' in changes || firstRun) reconfigure();
});

addOwnCommands({
  SyncAuthorize: authorize,
  SyncGetStates: getStates,
  SyncRevoke: revoke,
  SyncSetConfig: setConfig,
  SyncStart: sync,
});

function reconfigure() {
  if (initialize()) {
    if (!unwatch) {
      unwatch = onStorageChanged(dbSentry);
    }
  } else {
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  }
}

function dbSentry({ keys }) {
  for (const k of keys) {
    if (keysToSyncRe.test(k)) {
      sync();
      break;
    }
  }
}
