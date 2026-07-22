import { isEmpty } from '@/common';
import { kDownloads } from '@/common/consts';
import { FORBIDDEN_HEADER_RE, requests } from './requests-core';
import { downloads, flushSession } from './session-data';

const objEntryToApiHeader = e => !FORBIDDEN_HEADER_RE.test(e[0]) && { name: e[0], value: e[1] };

/**
 * @param {GMReq.Message.Web} opts
 * @param {GMReq.EventTypeMap[]} events
 * @param {string} id
 * @param {GMReq.BG} req
 * @param {VMMessageSender} src
 * @param {string} [fileName]
 */
export default async function downloadViaApi(opts, events, id, req, src, fileName) {
  const { headers } = opts;
  const dlId = await browser.downloads.download({
    conflictAction: opts.conflictAction,
    filename: fileName,
    headers: headers ? Object.entries(headers).map(objEntryToApiHeader).filter(Boolean) : undefined,
    method: opts.method || 'GET',
    saveAs: opts.saveAs,
    url: opts.url,
  });
  if (isEmpty(downloads)) {
    browser.downloads.onChanged.addListener(onDownloadChanged);
  }
  downloads[dlId] = id;
  req.dlEvents = events[0];
  req.dlId = dlId;
};

/** @param {browser.downloads._OnChangedDownloadDelta} _ */
async function onDownloadChanged({ id, error, state } = {}) {
  const reqId = downloads[id];
  const req = requests[reqId];
  if (!req) {
    return;
  }
  if (error) {
    req.cbe(error.current);
  }
  if (!state) {
    // nothing
  } else if (state.current === 'in_progress') {
    // Using separate timers for each download to spread the messages
    if (req.dlEvents.progress) req.timer = setInterval(queryDownload, 1000, id, reqId, req);
  } else {
    delete downloads[id];
    flushSession(kDownloads, downloads);
    if (req.timer) clearInterval(req.timer);
    if (isEmpty(downloads)) browser.downloads.onChanged.removeListener(onDownloadChanged);
  }
  queryDownload(id, reqId, req);
}

async function queryDownload(id, reqId, req) {
  const [info] = await browser.downloads.search({ id });
  if (!info) return; // stray iteration before clearRequest()
  const { state, totalBytes } = info;
  const inProgress = state === 'in_progress';
  const type = inProgress ? 'progress' : state === 'interrupted' ? 'abort' : 'load';
  const msg = {
    type,
    id: reqId,
    data: {
      [kResponse]: null,
      [kResponseHeaders]: null,
      finalUrl: info.finalUrl,
      lengthComputable: totalBytes >= 0,
      loaded: info.bytesReceived,
      readyState: inProgress ? 3 : 4,
      total: totalBytes,
    },
  };
  if (req.dlEvents[type]) {
    req.cb(msg);
  }
  if (!inProgress) {
    msg.type = 'loadend';
    req.cb(msg);
  }
}
