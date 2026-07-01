import { leaseBlobUrl, noop } from '@/common';
import setClipboard from '@/common/clipboard';
import { downloadBlob } from '@/common/download';
import { clientCommands, sendCmdToSW } from '@/common/sw-messaging';
import { initXHR, xhrs } from './xhr';

Object.assign(clientCommands, {
  DownloadBlob: downloadBlob,
  LeaseBlob: leaseBlobUrl,
  RevokeBlob: URL.revokeObjectURL,
  SetClipboard: setClipboard,
  /** @param {XHRStartOptions} opts */
  XHRStart(opts) {
    const [req] = opts.cb;
    req.cb = sendCmdToSW.bind(null, 'XHRNotify');
    initXHR(opts, req.id);
  },
  XHRStop: id => xhrs.get(id).abort(),
});

chrome.runtime.onConnect.addListener(noop);
