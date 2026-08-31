import setClipboard from '@/common/clipboard';
import { handlersSW, sendCmdToSW } from '@/common/messaging-sw';
import { leaseBlobUrl } from '@/common/util';
import { initXHR, xhrs } from './xhr';

let autoCloseTimer;

Object.assign(handlersSW, {
  LeaseBlob: leaseBlobUrl,
  async Fetch([url, init, get = 'text']) {
    const req = await fetch(url, init);
    return {
      data: await req[get](),
      headers: [...req.headers],
      status: req.status,
    };
  },
  RevokeBlob: URL.revokeObjectURL,
  SetClipboard: setClipboard,
  /** @param {XHRStartOptions} opts */
  XHRStart(opts) {
    const [req] = opts.cb;
    req.cb = sendCmdToSW.bind(null, 'XHRNotify');
    initXHR(opts, req.id);
  },
  XHRStop: id => xhrs.get(id)?.abort(),
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'offscreen') {
    autoCloseTimer &&= clearTimeout(autoCloseTimer);
    port.onDisconnect.addListener(autoClose);
  }
});

function autoClose() {
  autoCloseTimer ||= setTimeout(close, 15 * 60e3);
}
