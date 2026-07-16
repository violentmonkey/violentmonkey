import { getClients, rejectPending, sendCmdTo } from '@/common/messaging-sw';

/** @type {chrome.runtime.Port | Promise} */
let port;
/** @type {WindowClient} */
let client;

export default async function callOffscreen(cmd, data, src) {
  port ||= init();
  if (port.then) await port;
  return sendCmdTo(cmd, data, client, src);
}

async function init() {
  const URL = extensionRoot + 'offscreen/index.html';
  try {
    await chrome.offscreen.createDocument({
      url: URL,
      justification: 'MV3 requirement',
      reasons: ['BLOBS', 'CLIPBOARD', 'DOM_PARSER', 'WORKERS'],
    });
  } catch (err) {
    if (!err.message.startsWith('Only a single offscreen')) {
      err.message = '[offscreen] ' + err.message;
      throw err;
    }
  }
  for (const c of await getClients()) {
    if (c.url === URL) {
      client = c;
      port = chrome.runtime.connect({name: 'offscreen'});
      port.onDisconnect.addListener(onDisconnect);
      return;
    }
  }
  if (__.DEV) {
    throw new Error('[offscreen] Document not found, see chrome://extensions for details');
  }
}

function onDisconnect() {
  port = null;
  rejectPending('Offscreen document disconnected');
}
