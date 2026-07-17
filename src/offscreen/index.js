import { leaseBlobUrl } from '@/common';
import setClipboard from '@/common/clipboard';
import { downloadBlob } from '@/common/download';
import handlers from '@/common/handlers';
import { sendCmdToSW } from '@/common/messaging-sw';
import { DriveProviders } from '@usync/drive';
import { initXHR, xhrs } from './xhr';

let drive;
let autoCloseTimer;

Object.assign(handlers, {
  Alert: msg => alert(msg),
  DownloadBlob: downloadBlob,
  LeaseBlob: leaseBlobUrl,
  Drive: ([cmd, args, init], src, transfer) => (
    init.length && initDrive(...init),
    cmd === 'list'
      ? (listDrive(cmd, args, transfer), transfer[0])
      : drive[cmd](...args)
  ),
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

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'offscreen') {
    autoCloseTimer &&= clearTimeout(autoCloseTimer);
    port.onDisconnect.addListener(autoClose);
  }
});

function autoClose() {
  autoCloseTimer ||= setTimeout(close, 15 * 60e3);
}

function initDrive(provider, opts, context) {
  drive = new DriveProviders[provider](opts, context !== 'auth' ? context : {
    authorizer: Object.create(new Proxy({}, {
      get: (obj, cmd) => (obj[cmd] =
        (...args) => sendCmdToSW('DriveAuth', [cmd, args])
      ),
    })),
  });
}

async function listDrive(cmd, args, transfer) {
  const mc = new MessageChannel();
  const port = mc.port1;
  transfer[0] = mc.port2; // must be before async work as it's used by the caller
  try {
    for await (const item of drive[cmd](...args)) {
      port.postMessage({ res: item });
    }
    port.postMessage(null);
  } catch (err) {
    // `cause` is a standard property that can be sent via messaging.
    err.cause = err.response?.status;
    port.postMessage({ err });
  }
}
