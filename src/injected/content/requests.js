import { sendCmd } from '#/common';
import { includes } from '../utils/helpers';
import bridge from './bridge';

const { fetch } = global;
const { arrayBuffer: getArrayBuffer, blob: getBlob } = Response.prototype;

const requests = {};

bridge.addHandlers({
  async GetRequestId({ eventsToNotify, wantsBlob }, realm) {
    const id = await sendCmd('GetRequestId', eventsToNotify);
    requests[id] = { eventsToNotify, realm, wantsBlob };
    return id;
  },
  HttpRequest: sendCmd,
  AbortRequest: sendCmd,
});

bridge.addBackgroundHandlers({
  async HttpRequested(msg) {
    const { blobbed, id, numChunks, type } = msg;
    const req = requests[id];
    if (!req) return;
    const isLoadEnd = type === 'loadend';
    // only CONTENT realm can read blobs from an extension:// URL
    const url = blobbed
      && !req.response
      && req.eventsToNotify::includes(type)
      && msg.data.response;
    // messages will come while blob is fetched so we'll temporarily store the Promise
    if (url) {
      req.response = importBlob(url, req);
    }
    // ...which can be awaited in these subsequent messages
    if (req.response?.then) {
      req.response = await req.response;
    }
    // ...and make sure loadend's bridge.post() runs last
    if (isLoadEnd && blobbed) {
      await 0;
    }
    if (url) {
      msg.data.response = req.response;
    }
    bridge.post('HttpRequested', msg, req.realm);
    // If the user in incognito supplied only `onloadend` then it arrives first, followed by chunks
    if (isLoadEnd) {
      req.gotLoadEnd = true;
      req.gotChunks = req.gotChunks || (numChunks || 0) <= 1;
    } else if (msg.chunk?.last) {
      req.gotChunks = true;
    }
    // If the user supplied any event before `loadend`, all chunks finish before `loadend` arrives
    if (req.gotLoadEnd && req.gotChunks) {
      delete requests[id];
    }
  },
});

async function importBlob(url, { wantsBlob }) {
  const data = await (await fetch(url))::(wantsBlob ? getBlob : getArrayBuffer)();
  sendCmd('RevokeBlob', url);
  return data;
}
