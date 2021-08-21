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
import { commands } from '../utils/message';

Object.assign(commands, {
  SyncAuthorize: authorize,
  SyncRevoke: revoke,
  SyncStart: sync,
  SyncSetConfig: setConfig,
});

export {
  initialize,
  sync,
  getStates,
  authorize,
  revoke,
};
