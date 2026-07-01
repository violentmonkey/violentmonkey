import { onClientMessage } from '@/common/sw-messaging';
import { resolveVirtualUrl } from './utils/tab-redirector';
import { handleCommandMessage } from '.';

/** @param {ExtendableMessageEvent} evt */
global.onactivate = evt => evt.waitUntil(clients.claim());
/** @param {FetchEvent} evt */
global.onfetch = evt => evt.respondWith(Response.redirect(resolveVirtualUrl(evt.request.url)));
global.oninstall = evt => {
  evt.addRoutes({
    condition: {not: {urlPattern: `${extensionRoot}*.user.js`, requestDestination: 'document'}},
    source: 'network',
  });
  importScripts('tld.js');
};
global.onmessage = onClientMessage.bind(null, handleCommandMessage);
