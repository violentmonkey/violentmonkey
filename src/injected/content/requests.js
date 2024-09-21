import bridge, { addBackgroundHandlers, addHandlers, onScripts } from './bridge';
import { sendCmd } from './util';
import { UA_PROPS } from '../util';

const {
  fetch: safeFetch,
  FileReader: SafeFileReader,
  FormData: SafeFormData,
} = global;
const { arrayBuffer: getArrayBuffer, blob: getBlob } = ResponseProto;
const BlobProto = SafeBlob[PROTO];
const getBlobType = describeProperty(BlobProto, 'type').get;
const getTypedArrayBuffer = describeProperty(getPrototypeOf(SafeUint8Array[PROTO]), 'buffer').get;
const getReaderResult = describeProperty(SafeFileReader[PROTO], 'result').get;
const readAsDataURL = SafeFileReader[PROTO].readAsDataURL;
const fdAppend = SafeFormData[PROTO].append;
const CHUNKS = 'chunks';
const LOAD = 'load';
const LOADEND = 'loadend';
const isBlobXhr = req => req[kXhrType] === 'blob';
/** @type {GMReq.Content} */
const requests = createNullObj();
let navigator, getUAData, getUAProps, getHighEntropyValues;

onScripts.push(data => {
  // The tab may have a different UA due to a devtools override or about:config
  navigator = global.navigator;
  getUAProps = [];
  for (let p = getPrototypeOf(navigator), i = 0; p && i < UA_PROPS.length; i++) {
    getUAProps[i] = describeProperty(p, UA_PROPS[i]).get;
    if (!i && (p = describeProperty(p, 'userAgentData')) && (getUAData = p.get)) {
      // Guarding against broken implementations in linux chromium forks
      if ((p = navigator::getUAData())
      && (p = getPrototypeOf(p))
      && (getHighEntropyValues = p.getHighEntropyValues)) {
        data.info.uad = true;
      } else {
        p = getUAData = null;
      }
    }
  }
});

// TODO: extract all prop names used across files into consts.js to ensure sameness
addHandlers({
  /**
   * @param {GMReq.Message.Web} msg
   * @param {VMScriptInjectInto} realm
   * @returns {Promise<void>}
   */
  async HttpRequest(msg, realm) {
    if (IS_FIREFOX) msg = nullObjFrom(msg); // copying into our realm to set its props freely
    else setPrototypeOf(msg, null);
    const { url } = msg;
    const data = !IS_FIREFOX && msg.data;
    const uaData = getUAData && navigator::getUAData();
    const sch = url::slice(0, 5);
    if (sch === 'data:' || sch === 'blob:') {
      return requestVirtualUrl(msg, url, realm);
    }
    requests[msg.id] = {
      __proto__: null,
      realm,
      [kXhrType]: msg[kXhrType],
    };
    // In Firefox we recreate FormData in bg::decodeBody
    if (data && data.length > 1 && data[1] !== 'usp') {
      // TODO: support huge data by splitting it to multiple messages
      msg.data = await encodeBody(data[0], data[1]);
    }
    msg.ua = getUAProps::map((fn, i) => (!i ? navigator : uaData)::fn());
    return sendCmd('HttpRequest', msg);
  },
  AbortRequest: true,
  UA: () => navigator::getUAProps[0](),
  UAD() {
    if (getUAData) {
      const res = createNullObj();
      const uaData = navigator::getUAData();
      for (let i = 1; i < getUAProps.length; i++) {
        res[UA_PROPS[i]] = uaData::getUAProps[i]();
      }
      return res;
    }
  },
  UAH: hints => (navigator::getUAData())::getHighEntropyValues(hints),
});

addBackgroundHandlers({
  /**
   * @param {GMReq.Message.BG} msg
   * @returns {Promise<void>}
   */
  async HttpRequested(msg) {
    const { id, data } = msg;
    const req = requests[id];
    if (!req) {
      if (process.env.DEV) console.warn('[HttpRequested][content]: no request for id', id);
      return;
    }
    if (hasOwnProperty(msg, 'chunk')) {
      processChunk(req, data, msg);
      return;
    }
    let response = data?.[kResponse];
    if (response != null) {
      if (msg.blobbed) {
        response = await importBlob(response, isBlobXhr(req));
        sendCmd('RevokeBlob', response);
      } else if (msg.chunked) {
        processChunk(req, response);
        response = req[CHUNKS];
        delete req[CHUNKS];
        if (isBlobXhr(req)) {
          response = new SafeBlob([response], { type: msg.contentType });
        } else if (req[kXhrType]) {
          response = response::getTypedArrayBuffer();
        } else {
          // sending text chunks as-is to avoid memory overflow due to concatenation
        }
      }
      data[kResponse] = response;
    }
    if (msg.type === LOADEND) {
      delete requests[msg.id];
    }
    sendHttpRequested(msg, req.realm);
  },
});

async function requestVirtualUrl(msg, url, realm) {
  let data, eventLoad;
  const { events, [kFileName]: fileName } = msg;
  const wantsData = (eventLoad = events::includes(LOAD)) || events::includes(LOADEND);
  if (wantsData || fileName && IS_FIREFOX) {
    data = await importBlob(url, isBlobXhr(msg));
  }
  if (fileName) {
    // download in bg to a) circumvent CSP in Firefox and b) use a single throttled download chain
    sendCmd('DownloadBlob', [IS_FIREFOX ? data : url, fileName]);
    data = null;
  }
  for (;;) {
    msg = {
      id: msg.id,
      type: eventLoad ? LOAD : LOADEND,
      data: {
        finalUrl: url,
        readyState: 4,
        status: 200,
        [kResponse]: data,
        [kResponseHeaders]: '',
      },
    };
    sendHttpRequested(msg, realm);
    if (eventLoad) eventLoad = data = null;
    else break;
  }
}

function sendHttpRequested(msg, realm) {
  bridge.post('HttpRequested', msg, realm);
}

/**
 * Only a content script can read blobs from an extension:// URL
 * @param {string} url
 * @param {boolean} isBlob
 * @returns {Promise<Blob|ArrayBuffer>}
 */
async function importBlob(url, isBlob) {
  return (await safeFetch(url))::(isBlob ? getBlob : getArrayBuffer)();
}

/**
 * @param {GMReq.Content} req
 * @param {string} data
 * @param {GMReq.Message.BGChunk} [msg]
 */
function processChunk(req, data, msg) {
  if (!req[kXhrType]) {
    setOwnProp(req[CHUNKS] || (req[CHUNKS] = ['']), msg ? msg.i : 0, data);
    return;
  }
  data = safeAtob(data);
  const len = data.length;
  const arr = req[CHUNKS] || (req[CHUNKS] = new SafeUint8Array(msg ? msg.size : len));
  for (let pos = msg?.chunk || 0, i = 0; i < len;) {
    arr[pos++] = safeCharCodeAt(data, i++);
  }
}

/** Doing it here because vault's SafeResponse+blob() doesn't work in injected-web */
async function encodeBody(body, mode) {
  if (mode === 'fd') {
    if (!body.length) { // see decodeBody comments about FormData in Chrome
      return [body, mode];
    }
    const fd = new SafeFormData();
    body::forEach(entry => fd::fdAppend(entry[0], entry[1]));
    body = fd;
  }
  const wasBlob = isInstance(body, BlobProto);
  const blob = wasBlob ? body : await new SafeResponse(body)::getBlob();
  const reader = new SafeFileReader();
  return new SafePromise(resolve => {
    reader::on(LOAD, () => resolve([
      reader::getReaderResult(),
      blob::getBlobType(),
      wasBlob,
    ]));
    reader::readAsDataURL(blob);
  });
}
