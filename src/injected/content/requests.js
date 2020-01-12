import { INJECT_CONTENT } from '#/common/consts';
import { sendCmd, sendMessage } from '../utils';
import { buffer2stringSafe, includes } from '../utils/helpers';
import bridge from './bridge';

const requests = {};

const { fetch } = global;
const { arrayBuffer: getArrayBuffer, blob: getBlob } = Response.prototype;

bridge.addHandlers({
  async GetRequestId({ eventsToNotify, wantsBlob }, realm) {
    const id = await sendCmd('GetRequestId', eventsToNotify);
    requests[id] = { realm, eventsToNotify, wantsBlob };
    bridge.post({ cmd: 'GotRequestId', data: id, realm });
  },
  HttpRequest: sendMessage,
  AbortRequest: sendMessage,
});

bridge.addBackgroundHandlers({
  async HttpRequested(msg) {
    const req = requests[msg.id];
    if (!req) return;
    const { realm } = req;
    const isLoadEnd = msg.type === 'loadend';
    // only CONTENT realm can read blobs from an extension:// URL
    const url = msg.isBlob && msg.data.response;
    if (url) {
      // messages will come while blob is fetched so we'll temporarily store the Promise
      if (!req.blob && req.eventsToNotify::includes(msg.type)) {
        msg.isBlob = realm !== INJECT_CONTENT;
        req.blob = importBlob(url, req.wantsBlob, msg.isBlob);
      }
      // ...which can be awaited in these subsequent messages
      if (req.blob?.then) {
        req.blob = await req.blob;
      }
      // ...and make sure loadend's bridge.post() runs last
      if (isLoadEnd) await 0;
      msg.data.response = req.blob;
    }
    bridge.post({ cmd: 'HttpRequested', data: msg, realm });
    if (isLoadEnd) delete requests[msg.id];
  },
});

async function importBlob(url, wantsBlob, reexport) {
  // page realm CSP may block fetching blobs so we'll reexport as text
  const data = await (await fetch(url))::(wantsBlob && !reexport ? getBlob : getArrayBuffer)();
  return reexport ? buffer2stringSafe(data) : data;
}
