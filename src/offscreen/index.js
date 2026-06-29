import { noop } from '@/common';
import setClipboard from '@/common/clipboard';
import { clientCommands } from '@/common/sw-messaging';

Object.assign(clientCommands, {
  SetClipboard: setClipboard,
});

chrome.runtime.onConnect.addListener(noop);
