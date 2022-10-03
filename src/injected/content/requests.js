import bridge from './bridge';
import { getFullUrl, makeElem, sendCmd } from './util';

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
/** @type {GMReq.Content} */
const requests = createNullObj();
let downloadChain = promiseResolve();

// TODO: extract all prop names used across files into consts.js to ensure sameness
bridge.addHandlers({
  /**
   * @param {GMReq.Message.Web} msg
   * @param {VMScriptInjectInto} realm
   * @returns {Promise<void>}
   */
  async HttpRequest(msg, realm) {
    /** @type {GMReq.Content} */
    requests[msg.id] = createNullObj({
      realm,
      wantsBlob: msg.xhrType === 'blob',
    }, msg, [
      'eventsToNotify',
      'fileName',
    ]);
    msg.url = getFullUrl(msg.url);
    let { data } = msg;
    if (data[1]) {
      // TODO: support huge data by splitting it to multiple messages
      data = await encodeBody(data[0], data[1]);
      msg.data = cloneInto ? cloneInto(data, msg) : data;
    }
    return sendCmd('HttpRequest', msg);
  },
  AbortRequest: true,
});

bridge.addBackgroundHandlers({
  /**
   * @param {GMReq.Message.BG} msg
   * @returns {Promise<void>}
   */
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
    if (type === 'loadend') {
      req.gotLoadEnd = true;
    }
    if (importing) {
      data.response = req.bin;
    }
    const fileName = type === 'load' && req.fileName;
    if (fileName) {
      req.fileName = '';
      await downloadBlob(IS_FIREFOX ? response : req.bin, fileName);
    }
    bridge.post('HttpRequested', msg, req.realm);
    if (req.gotLoadEnd && req.gotChunks) {
      delete requests[id];
    }
  },
});

/**
 * @param {GMReq.Content} req
 * @param {string} url
 * @returns {Promise<Blob|ArrayBuffer>}
 */
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

/**
 * ArrayBuffer/Blob in Chrome incognito is transferred in string chunks
 * @param {GMReq.Content} req
 * @param {GMReq.Message.BG} msg
 * @return {Promise<Blob|ArrayBuffer>}
 */
function receiveAllChunks(req, msg) {
  pickIntoNullObj(req, msg, ['dataSize', 'contentType']);
  req.arr = new SafeUint8Array(req.dataSize);
  processChunk(req, msg.data.response, 0);
  return !req.gotChunks
    ? new SafePromise(resolve => { req.resolve = resolve; })
    : finishChunks(req);
}

/**
 * @param {GMReq.Content} req
 * @param {GMReq.Message.Chunk} chunk
 */
function receiveChunk(req, { data, pos, last }) {
  processChunk(req, data, pos);
  if (last) {
    req.gotChunks = true;
    req.resolve(finishChunks(req));
    delete req.resolve;
  }
}

/**
 * @param {GMReq.Content} req
 * @param {string} data
 * @param {number} pos
 */
function processChunk(req, data, pos) {
  const { arr } = req;
  data = safeAtob(data);
  for (let len = data.length, i = 0; i < len; i += 1, pos += 1) {
    arr[pos] = data::charCodeAt(i);
  }
}

/**
 * @param {GMReq.Content} req
 * @return {Blob|ArrayBuffer}
 */
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
