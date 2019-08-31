import { downloadBlob } from '#/common/download';
import { onRequestCreate } from './requests';

export function onDownload(arg1, arg2) {
  let options;
  if (typeof arg1 === 'string') {
    options = { url: arg1, name: arg2 };
  } else {
    options = arg1;
  }
  if (!options || !options.url) {
    throw new Error('GM_download: Invalid parameter!');
  }
  return onDownloadBrowser(options);
}

function onDownloadBrowser({
  url,
  name,
  headers,
  timeout,
  onerror,
  onload,
  onprogress,
  ontimeout,
}) {
  return onRequestCreate({
    method: 'GET',
    responseType: 'arraybuffer',
    url,
    headers,
    timeout,
    onerror,
    onprogress,
    ontimeout,
    onload(res) {
      const blob = new Blob([res.response], { type: 'application/octet-stream' });
      downloadBlob(blob, name, onload);
    },
  });
}
