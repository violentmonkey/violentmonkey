import { handleCommandMessage } from '.';
import { onClientMessage } from '@/common/sw-messaging';

global.oninstall = () => importScripts('tld.js');
global.onactivate = e => e.waitUntil(clients.claim());
global.onmessage = onClientMessage.bind(null, handleCommandMessage);
