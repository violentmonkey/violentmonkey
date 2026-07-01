import { leaseBlobUrl, makePause } from '@/common';
import { addPublicCommands } from '@/background/utils';

let chain = Promise.resolve();

addPublicCommands({
  DownloadBlob(args) {
    downloadBlob(...args);
  },
});

/**
 * @param {Blob|string} what
 * @param {string} name
 * @param {boolean} force
 */
export async function downloadBlob(what, name, force) {
  // Frequent downloads are ignored in Chrome and possibly other browsers
  if (!force) {
    chain = chain.then(() => (downloadBlob(what, name, true), makePause(150)));
    return;
  }
  const url = isObject(what) ? leaseBlobUrl(what) : what;
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  a.click();
}
