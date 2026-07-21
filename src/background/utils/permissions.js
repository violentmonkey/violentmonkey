import browser from '@/common/browser';
import { kDownloads } from '@/common/consts';
import broadcast from './broadcast';
import { initDependency } from './init';

export let permissionDownloads;
/** @type {Set<(state: boolean) => any>} */
export const onPermissionChanged = new Set();
initDependency(browser.permissions.contains({ permissions: [kDownloads] })
    .then(onDownloadsToggled));

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
  browser.permissions.onAdded[`${ok ? 'remove' : 'add'}Listener`](onPermissionAdded);
  browser.permissions.onRemoved[`${ok ? 'add' : 'remove'}Listener`](onPermissionRemoved);
  if (dynamic) {
    broadcast('SetPermissions', { [kDownloads]: ok });
    for (const fn of onPermissionChanged) fn(ok);
  }
}
