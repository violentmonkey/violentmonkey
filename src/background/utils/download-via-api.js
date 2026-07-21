import { isEmpty } from '@/common';
import { kDownloads } from '@/common/consts';
import { requests } from './requests-core';
import { downloads, flushSession } from './session-data';

const objEntryToApiHeader = e => ({ name: e[0], value: e[1] });

export default async function downloadViaApi(opts, dlEvents, reqId, req) {
  const id = await browser.downloads.download({
    conflictAction: opts.conflictAction,
    filename: opts[kFileName],
    headers: Object.entries(opts.headers || {}).map(objEntryToApiHeader),
    method: opts.method || 'GET',
    saveAs: opts.saveAs,
    url: opts.url,
  });
  if (isEmpty(downloads)) {
    browser.downloads.onChanged.addListener(onDownloadChanged);
  }
  downloads[id] = reqId;
  req.dlEvents = dlEvents;
  req.dlId = id;
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
