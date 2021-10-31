import { isPromise, sendCmd } from '#/common';
import bridge from './bridge';
import { getFullUrl, makeElem } from './util-content';

const {
  fetch: fetchSafe,
} = global;
const { arrayBuffer: getArrayBuffer, blob: getBlob } = ResponseProto;
const { createObjectURL, revokeObjectURL } = URL;

const requests = createNullObj();
let downloadChain = promiseResolve();

bridge.addHandlers({
  HttpRequest(msg, realm) {
    requests[msg.id] = {
      __proto__: null,
      realm,
    }::pickIntoThis(msg, [
      'eventsToNotify',
      'fileName',
      'wantsBlob',
    ]);
    msg.url = getFullUrl(msg.url);
    sendCmd('HttpRequest', msg);
  },
  AbortRequest: true,
});

bridge.addBackgroundHandlers({
  async HttpRequested(msg) {
    const { id } = msg;
    const req = requests[id];
    if (!req) return;
    const { chunk } = msg;
    if (chunk) {
      receiveChunk(req, chunk);
      return;
    }
    const { blobbed, data, chunked, type } = msg;
    const isLoadEnd = type === 'loadend';
    // only CONTENT realm can read blobs from an extension:// URL
    const response = data
      && req.eventsToNotify::includes(type)
      && data.response;
    // messages will come while blob is fetched so we'll temporarily store the Promise
    const importing = response && (blobbed || chunked);
    if (importing) {
      req.bin = blobbed
        ? importBlob(req, response)
        : receiveAllChunks(req, msg);
    }
    // ...which can be awaited in these subsequent messages
    if (isPromise(req.bin)) {
      req.bin = await req.bin;
    }
    // If the user in incognito supplied only `onloadend` then it arrives first, followed by chunks
    if (isLoadEnd) {
      // loadend's bridge.post() should run last
      await 0;
      req.gotLoadEnd = true;
    }
    // If the user supplied any event before `loadend`, all chunks finish before `loadend` arrives
    if ((msg.numChunks || 0) <= 1) {
      req.gotChunks = true;
    }
    if (importing) {
      data.response = req.bin;
    }
    const fileName = type === 'load' && req.bin && req.fileName;
    if (fileName) {
      req.fileName = '';
      await downloadBlob(req.bin, fileName);
    }
    bridge.post('HttpRequested', msg, req.realm);
    if (req.gotLoadEnd && req.gotChunks) {
      delete requests[id];
    }
  },
});

async function importBlob(req, url) {
  const data = await (await fetchSafe(url))::(req.wantsBlob ? getBlob : getArrayBuffer)();
  sendCmd('RevokeBlob', url);
  return data;
}

function downloadBlob(blob, fileName) {
  const url = createObjectURL(blob);
  const a = makeElem('a', {
    href: url,
    download: fileName,
  });
  const res = downloadChain::then(() => {
    a::fire(new MouseEventSafe('click'));
    revokeBlobAfterTimeout(url);
  });
  // Frequent downloads are ignored in Chrome and possibly other browsers
  downloadChain = res::then(sendCmd('SetTimeout', 150));
  return res;
}

async function revokeBlobAfterTimeout(url) {
  await sendCmd('SetTimeout', 3000);
  revokeObjectURL(url);
}

/** ArrayBuffer/Blob in Chrome incognito is transferred in string chunks */
function receiveAllChunks(req, msg) {
  req::pickIntoThis(msg, ['dataSize', 'contentType']);
  req.chunks = [msg.data.response];
  return msg.numChunks > 1
    ? new PromiseSafe(resolve => { req.resolve = resolve; })
    : decodeChunks(req);
}

function receiveChunk(req, { data, i, last }) {
  setOwnProp(req.chunks, i, data);
  if (last) {
    req.gotChunks = true;
    req.resolve(decodeChunks(req));
    delete req.resolve;
  }
}

function decodeChunks(req) {
  const arr = new Uint8ArraySafe(req.dataSize);
  let dstIndex = 0;
  req.chunks::forEach(chunk => {
    chunk = atobSafe(chunk);
    for (let len = chunk.length, i = 0; i < len; i += 1, dstIndex += 1) {
      arr[dstIndex] = chunk::charCodeAt(i);
    }
  });
  delete req.chunks;
  return req.wantsBlob
    ? new BlobSafe([arr], { type: req.contentType })
    : arr.buffer;
}
