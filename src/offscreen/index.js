import { leaseBlobUrl, noop } from '@/common';
import setClipboard from '@/common/clipboard';
import { downloadBlob } from '@/common/download';
import { clientCommands, sendCmdToSW } from '@/common/sw-messaging';
import { DriveProviders } from '@usync/drive';
import { initXHR, xhrs } from './xhr';

let drive;

async function listDrive(cmd, args, transfer) {
  const mc = new MessageChannel();
  const port = mc.port1;
  transfer[0] = mc.port2;
  for await (const item of drive[cmd](...args)) {
    port.postMessage(item);
  }
  port.postMessage(NaN);
}

Object.assign(clientCommands, {
  DownloadBlob: downloadBlob,
  LeaseBlob: leaseBlobUrl,
  Drive: ([cmd, args], src, transfer) =>
    cmd === 'list' ? (listDrive(cmd, args, transfer), transfer[0])
      : drive[cmd](...args),
  DriveInit([provider, opts, context]) {
    if (context === 'auth') {
      context = {
        authorizer: Object.create(new Proxy({}, {
          get: (obj, cmd) => (obj[cmd] =
            (...args) => sendCmdToSW('DriveAuth', [cmd, args])
          ),
        })),
      };
    }
    drive = new DriveProviders[provider](opts, context);
  },
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
