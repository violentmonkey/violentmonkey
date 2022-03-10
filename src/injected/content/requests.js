import bridge from './bridge';
import { getFullUrl, makeElem, sendCmd } from './util-content';

const {
  fetch: safeFetch,
  FileReader: SafeFileReader,
  FormData: SafeFormData,
} = global;
const { arrayBuffer: getArrayBuffer, blob: getBlob } = ResponseProto;
const { createObjectURL, revokeObjectURL } = URL;
const getBlobType = describeProperty(SafeBlob[PROTO], 'type').get;
const getReaderResult = describeProperty(SafeFileReader[PROTO], 'result').get;
const readAsDataURL = SafeFileReader[PROTO].readAsDataURL;
const fdAppend = SafeFormData[PROTO].append;

const requests = createNullObj();
let downloadChain = promiseResolve();

bridge.addHandlers({
  async HttpRequest(msg, realm) {
    requests[msg.id] = {
      __proto__: null,
      realm,
      wantsBlob: msg.xhrType === 'blob',
    }::pickIntoThis(msg, [
      'eventsToNotify',
      'fileName',
    ]);
    msg.url = getFullUrl(msg.url);
    if (msg.data[1]) {
      // TODO: support huge data by splitting it to multiple messages
      msg.data = await encodeBody(msg.data[0], msg.data[1]);
    }
    sendCmd('HttpRequest', msg);
  },
  AbortRequest: true,
});

bridge.addBackgroundHandlers({
  async HttpRequested(msg) {
    const { id, chunk } = msg;
    const req = requests[id];
    if (!req) return;
    if (chunk) {
      receiveChunk(req, chunk);
      return;
    }
    if ((msg.numChunks || 1) === 1) {
      req.gotChunks = true;
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
    // If the user supplied any event before `loadend`, all chunks finish before `loadend` arrives
    if (isLoadEnd) {
      // loadend's bridge.post() should run last
      await 0;
      req.gotLoadEnd = true;
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
  const data = await (await safeFetch(url))::(req.wantsBlob ? getBlob : getArrayBuffer)();
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
    a::fire(new SafeMouseEvent('click'));
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
  req.arr = new SafeUint8Array(req.dataSize);
  processChunk(req, msg.data.response, 0);
  return !req.gotChunks
    ? new SafePromise(resolve => { req.resolve = resolve; })
    : finishChunks(req);
}

function receiveChunk(req, { data, pos, last }) {
  processChunk(req, data, pos);
  if (last) {
    req.gotChunks = true;
    req.resolve(finishChunks(req));
    delete req.resolve;
  }
}

function processChunk(req, data, pos) {
  const { arr } = req;
  data = safeAtob(data);
  for (let len = data.length, i = 0; i < len; i += 1, pos += 1) {
    arr[pos] = data::charCodeAt(i);
  }
}

function finishChunks(req) {
  const { arr } = req;
  delete req.arr;
  return req.wantsBlob
    ? new SafeBlob([arr], { type: req.contentType })
    : arr.buffer;
}

/** Doing it here because vault's SafeResponse+blob() doesn't work in injected-web */
async function encodeBody(body, mode) {
  if (mode === 'fd') {
    const fd = new SafeFormData();
    body::forEach(entry => fd::fdAppend(entry[0], entry[1]));
    body = fd;
  }
  const wasBlob = body instanceof SafeBlob;
  const blob = wasBlob ? body : await new SafeResponse(body)::getBlob();
  const reader = new SafeFileReader();
  return new SafePromise(resolve => {
    reader::on('load', () => resolve([
      reader::getReaderResult(),
      blob::getBlobType(),
      wasBlob,
    ]));
    reader::readAsDataURL(blob);
  });
}
