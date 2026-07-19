import { SYNC_MERGE } from '@/common/consts-sync';
import { addOwnCommands, hookOptionsInit } from '../utils';
import { kAlarmSync } from '../utils/session-data';
import { onStorageChanged, S_CODE_PRE, S_SCRIPT_PRE } from '../utils/storage';
import {
  authorize,
  autoSync,
  getStates,
  initialize,
  revoke,
  setConfig,
  setSyncOnceMode,
  sync,
} from './sync-engine';
import './dropbox';
import './googledrive';
import './onedrive';
import './webdav';
import './s3';

const keysToSyncRe = new RegExp(`^(?:${[S_SCRIPT_PRE, S_CODE_PRE].join('|')})`);
let unwatch;

hookOptionsInit((changes, firstRun) => {
  if (firstRun || 'sync.current' in changes) {
    reconfigure();
  }
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

async function reconfigure() {
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
  if (__.MV3 && !unwatch !== !await chrome.alarms.get(kAlarmSync)) {
    if (unwatch) chrome.alarms.create(kAlarmSync, { periodInMinutes: 60 });
    else chrome.alarms.clear(kAlarmSync);
  }
}

function dbSentry(keys) {
  for (const k of keys) {
    if (keysToSyncRe.test(k)) {
      autoSync();
      break;
    }
  }
}
