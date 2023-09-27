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
import { addOwnCommands, init } from '../utils';

addOwnCommands({
  SyncAuthorize: authorize,
  SyncRevoke: revoke,
  SyncStart: sync,
  SyncSetConfig: setConfig,
});

init.then(initialize);

export {
  sync,
  getStates,
};
