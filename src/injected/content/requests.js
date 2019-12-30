import { INJECT_CONTENT } from '#/common/consts';
import { sendCmd, sendMessage } from '../utils';
import { includes } from '../utils/helpers';
import bridge from './bridge';

const requests = {};

const { fetch } = global;
const { blob: getBlob } = Response.prototype;
const { createObjectURL, revokeObjectURL } = URL;

bridge.addHandlers({
  async GetRequestId(eventsToNotify, realm) {
    const id = await sendCmd('GetRequestId', eventsToNotify);
    requests[id] = { realm, eventsToNotify };
    bridge.post({ cmd: 'GotRequestId', data: id, realm });
  },
  HttpRequest: sendMessage,
  AbortRequest: sendMessage,
  RevokeObjectURL: revokeObjectURL,
});

bridge.addBackgroundHandlers({
  async HttpRequested(msg) {
    const req = requests[msg.id];
    if (!req) return;
    const isLoadEnd = msg.type === 'loadend';
    // only CONTENT realm can read blobs from an extension:// URL
    const url = msg.isBlob && req.realm !== INJECT_CONTENT && msg.data.response;
    if (url) {
      // messages will come while blob is fetched so we'll temporarily store the Promise
      if (!req.blobUrl && req.eventsToNotify::includes(msg.type)) {
        req.blobUrl = reexportBlob(url);
      }
      // ...which can be awaited in these subsequent messages
      if (req.blobUrl?.then) {
        req.blobUrl = await req.blobUrl;
      }
      // ...and make sure loadend's bridge.post() runs last
      if (isLoadEnd) await 0;
      msg.data.response = req.blobUrl;
    }
    bridge.post({ cmd: 'HttpRequested', data: msg, realm: req.realm });
    if (isLoadEnd) delete requests[msg.id];
  },
});

async function reexportBlob(url) {
  return createObjectURL(await (await fetch(url))::getBlob());
}
