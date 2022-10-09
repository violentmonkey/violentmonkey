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
import { addOwnCommands } from '../utils/message';

addOwnCommands({
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
