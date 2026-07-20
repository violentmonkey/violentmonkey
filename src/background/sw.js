import { registerInjector } from '@/common/browser-scripts-api';
import { TLDJS } from '@/common/consts';
import { onClientMessage } from '@/common/messaging-sw';
import { autoSync } from './sync/sync-engine';
import { checkRemove, getData } from './utils/db';
import { addOwnCommands, init } from './utils/init';
import { removeNotification } from './utils/notifications';
import { getAllOptions } from './utils/options';
import { initPopup } from './utils/popup-tracker';
import { kAlarmRemove, kAlarmSync, kAlarmUpdate, kNotifications } from './utils/session-data';
import { resolveVirtualUrl } from './utils/tab-redirector';
import { autoUpdate } from './utils/update';
import { handleCommandMessage } from '.';

const GET_DATA_URL = extensionRoot + 'get-data.js';

const makeDataResponse = async url => {
  if (init) await init;
  const res = {
    opts: getAllOptions(),
    [url]: url === 'popup' ? await initPopup()
      : url === 'options' && await getData({ sizes: true }),
  };
  return new Response(`var BGDATA=${JSON.stringify(res)}`,
    { headers: { 'cache-control': 'no-cache' } });
};

/** @param {ExtendableMessageEvent} evt */
global.onactivate = evt => evt.waitUntil(clients.claim());

/** @param {FetchEvent} evt */
global.onfetch = async evt => {
  const url = evt.request.url;
  if (!url.startsWith(extensionRoot)) {
    // shouldn't happen
  } else if (url.startsWith(GET_DATA_URL)) {
    evt.respondWith(makeDataResponse(url.slice(GET_DATA_URL.length + 1)));
  } else if (/\.user\.js#(\d+)$/.test(url)) {
    evt.respondWith(Response.redirect(resolveVirtualUrl(evt.request.url)));
  }
};

global.oninstall = evt => {
  importScripts(TLDJS);
  // Not implemented in some browsers?
  evt.addRoutes?.({
    condition: { urlPattern: `${GET_DATA_URL}*` },
    source: 'fetch-event',
  });
  evt.addRoutes?.({
    condition: { not: { urlPattern: `${extensionRoot}*.user.js`, requestDestination: 'document' } },
    source: 'network',
  });
};

global.onmessage = onClientMessage.bind(null, handleCommandMessage);

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (init) await init;
  if (name === kAlarmRemove) {
    checkRemove();
  } else if (name === kAlarmSync) {
    autoSync();
  } else if (name === kAlarmUpdate) {
    autoUpdate();
  } else if (name.startsWith(kNotifications)) {
    removeNotification(name.slice(kNotifications.length));
  }
});

addOwnCommands({
  GetInjectorError: () => registerInjector(), // ensuring no parameters are passed
});
