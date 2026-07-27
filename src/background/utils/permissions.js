import browser from '@/common/browser';
import { kDownloads } from '@/common/consts';
import broadcast from './broadcast';
import { addOwnCommands, initDependency } from './init';

export let permissionDownloads;
/** @type {Set<(state: boolean) => any>} */
export const onPermissionChanged = new Set();
const browserPermissions = browser.permissions;
const { onAdded, onRemoved } = browserPermissions;
initDependency(browserPermissions.contains({ permissions: [kDownloads] })
    .then(onDownloadsToggled));

if (!__.MV3 && !onAdded) {
  addOwnCommands({
    SetPermissions(data) {
      if ((data = data[kDownloads]) != null) {
        onDownloadsToggled(data, true);
      }
    },
  });
}

function onPermissionAdded({ permissions }) {
  if (permissions?.includes(kDownloads)) {
    onDownloadsToggled(true, true);
  }
}

function onPermissionRemoved({ permissions }) {
  if (permissions?.includes(kDownloads)) {
    onDownloadsToggled(false, true);
  }
}

function onDownloadsToggled(ok, dynamic) {
  permissionDownloads = ok;
  onAdded?.[`${ok ? 'remove' : 'add'}Listener`](onPermissionAdded);
  onRemoved?.[`${ok ? 'add' : 'remove'}Listener`](onPermissionRemoved);
  if (dynamic) {
    broadcast('SetPermissions', { [kDownloads]: ok });
    for (const fn of onPermissionChanged) fn(ok);
  }
}
