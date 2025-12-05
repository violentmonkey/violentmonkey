import { SYNC_MERGE } from '@/common/consts-sync';
import { addOwnCommands, hookOptionsInit } from '../utils';
import { S_CODE_PRE, S_SCRIPT_PRE } from '../utils/storage';
import { onStorageChanged } from '../utils/storage-cache';
import {
  authorize,
  autoSync,
  getStates,
  initialize,
  revoke,
  setConfig,
  setSyncOnceMode,
  sync,
} from './base';
import './dropbox';
import './googledrive';
import './onedrive';
import './webdav';

const keysToSyncRe = new RegExp(`^(?:${[S_SCRIPT_PRE, S_CODE_PRE].join('|')})`);
let unwatch;

hookOptionsInit((changes, firstRun) => {
  if (firstRun || 'sync.current' in changes) reconfigure();
});

addOwnCommands({
  SyncAuthorize: authorize,
  SyncGetStates: getStates,
  SyncRevoke: revoke,
  SyncSetConfig: setConfig,
  SyncStart(mode) {
    setSyncOnceMode(mode || SYNC_MERGE);
    sync();
  },
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
      autoSync();
      break;
    }
  }
}
