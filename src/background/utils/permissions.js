import browser from '@/common/browser';
import { tryBrowserListener } from '@/common/browser-listener';
import { kDownloads } from '@/common/consts';
import broadcast from './broadcast';
import { addOwnCommands, initDependency } from './init';

export let permissionDownloads;
/** @type {Set<(state: boolean) => any>} */
export const onPermissionChanged = new Set();
const browserPermissions = browser.permissions || {};
const { onAdded, onRemoved } = browserPermissions;
initDependency(Promise.resolve()
    .then(() => browserPermissions.contains?.({ permissions: [kDownloads] }))
    .then(ok => onDownloadsToggled(!!ok), () => onDownloadsToggled(false)));

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
  tryBrowserListener(onAdded, `${ok ? 'remove' : 'add'}Listener`, onPermissionAdded);
  tryBrowserListener(onRemoved, `${ok ? 'add' : 'remove'}Listener`, onPermissionRemoved);
  if (dynamic) {
    broadcast('SetPermissions', { [kDownloads]: ok });
    for (const fn of onPermissionChanged) fn(ok);
  }
}
