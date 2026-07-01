import { leaseBlobUrl, noop } from '@/common';
import setClipboard from '@/common/clipboard';
import { clientCommands } from '@/common/sw-messaging';

Object.assign(clientCommands, {
  LeaseBlobUrl: leaseBlobUrl,
  RevokeBlobUrl: URL.revokeObjectURL,
  SetClipboard: setClipboard,
});

chrome.runtime.onConnect.addListener(noop);
