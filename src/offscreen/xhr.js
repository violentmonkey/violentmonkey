import { UPLOAD } from '@/common/consts';
import { blob2base64, leaseBlobUrl } from '@/common';
import { downloadBlob } from '@/common/download';
import { objectPick } from '@/common/object';

/* 1MB takes ~20ms to encode/decode so it doesn't block the process of the extension and web page,
 * which lets us and them be responsive to other events or user input. */
const CHUNK_SIZE = 1e6;
const TEXT_CHUNK_SIZE = IS_FIREFOX
  ? 256e6 // Firefox: max 512MB and string char is 2 bytes (unicode)
  : 10e6; // Chrome: max 64MB and string char is 6 bytes max (like \u0001 in internal JSON)
const SEND_XHR_PROPS = ['readyState', 'status', 'statusText'];
const SEND_PROGRESS_PROPS = ['lengthComputable', 'loaded', 'total'];
export const xhrs = __.MV3 && new Map();

const blob2chunk = (response, index, size) => blob2base64(response, index * size, size);
const text2chunk = (response, index, size) => response.substr(index * size, size);

/** @param {XHRStartOptions} _ */
export function initXHR({ open, headers, body, events, mime, props, cb }, id) {
  const [req] = cb;
  const xhr = req.xhr = new XMLHttpRequest();
  const onerror = 'on' + ERROR;
  if (id) xhrs.set(id, xhr);
  xhr.open(...open);
  Object.assign(xhr, props);
  cb = xhrCallbackWrapper(...cb);
  if (mime) xhr.overrideMimeType(mime);
  for (const k in headers) xhr.setRequestHeader(k, headers[k]);
  for (const evt in events[0]) xhr[`on${evt}`] = cb;
  for (const evt in events[1]) xhr[UPLOAD][`on${evt}`] = cb;
  xhr.onloadend = cb; // always send it for the internal cleanup
  xhr.onabort = cb; // for gmxhr().abort()
  xhr[onerror] = xhr[UPLOAD][onerror] = cb; // show it in tab's console if there's no callback
  xhr.send(body);
  return xhr;
}

/**
 * @param {GMReq.BG} req
 * @param {GMReq.EventTypeMap[]} events
 * @param {boolean} blobbed
 * @param {boolean} chunked
 * @param {boolean} isJson
 */
export function xhrCallbackWrapper(req, events, blobbed, chunked, isJson) {
  let lastPromise = Promise.resolve();
  let contentType;
  let dataSize;
  let numChunks = 0;
  let chunkSize;
  let getChunk;
  let fullResponse = null;
  let response;
  let responseHeaders;
  let sent = true;
  let sentTextLength = 0;
  let sentReadyState4;
  let tmp;
  const { id, xhr, [kFileName]: fileName } = req;
  const getResponseHeaders = () => req[kResponseHeaders] || xhr.getAllResponseHeaders();
  const eventQueue = [];
  const sequentialize = async () => {
    const evt = eventQueue.shift();
    const upload = evt.target === xhr ? 0 : 1;
    const { type } = evt;
    const shouldNotify = events[upload][type];
    const isEnd = !upload && type === 'loadend';
    const readyState4 = xhr.readyState === 4 || (sentReadyState4 = false); // reset on redirection
    if (!shouldNotify && !isEnd && type !== ERROR) {
      return;
    }
    // Firefox duplicates readystatechange for state=4 randomly, #1862
    if (readyState4 && type === 'readystatechange') {
      if (sentReadyState4) return;
      sentReadyState4 = true;
    }
    if (!contentType) {
      contentType = xhr.getResponseHeader('Content-Type') || '';
    }
    if (!upload && fullResponse !== xhr[kResponse]) {
      fullResponse = response = xhr[kResponse];
      sent = false;
      if (response && !fileName) {
        if ((tmp = response.length - sentTextLength)) { // a non-empty text response has `length`
          chunked = tmp > TEXT_CHUNK_SIZE;
          chunkSize = TEXT_CHUNK_SIZE;
          dataSize = tmp;
          getChunk = text2chunk;
          response = sentTextLength ? response.slice(sentTextLength) : response;
          sentTextLength += dataSize;
        } else {
          chunkSize = CHUNK_SIZE;
          dataSize = response.size;
          getChunk = blobbed ? leaseBlobUrl : blob2chunk;
        }
        numChunks = chunked ? Math.ceil(dataSize / chunkSize) || 1
          : blobbed ? 1 : 0;
      }
    }
    if (response && isEnd && fileName) {
      downloadBlob(response, fileName);
    }
    const shouldSendResponse =
      !upload && !fileName && shouldNotify && (!isJson || readyState4) && !sent;
    if (shouldSendResponse) {
      sent = true;
      for (let i = 1; i < numChunks; i += 1) {
        await req.cb({
          id,
          i,
          chunk: i * chunkSize,
          data: await getChunk(response, i, chunkSize),
          size: dataSize,
        });
      }
    }
    /* WARNING! We send `null` in the mandatory props because Chrome can't send `undefined`,
     * and for simple destructuring and `prop?.foo` in the receiver without getOwnProp checks. */
    await req.cb({
      blobbed,
      chunked,
      contentType,
      id,
      type,
      /** @type {VMScriptResponseObject} */
      data: shouldNotify ? {
        finalUrl: req.url || xhr.responseURL,
        ...objectPick(xhr, SEND_XHR_PROPS),
        ...objectPick(evt, SEND_PROGRESS_PROPS),
        [kResponse]: shouldSendResponse
          ? (numChunks ? await getChunk(response, 0, chunkSize) : response)
          : null,
        [kResponseHeaders]: responseHeaders !== (tmp = getResponseHeaders())
          ? (responseHeaders = tmp)
          : null,
      } : null,
      [UPLOAD]: upload,
    });
    if (__.MV3 && isEnd) xhrs.delete(id);
  };
  return (evt) => {
    eventQueue.push(evt);
    lastPromise = lastPromise.then(sequentialize);
  };
}
