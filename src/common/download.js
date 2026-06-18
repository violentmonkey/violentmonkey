import { makePause } from '@/common';
import { addPublicCommands } from '@/background/utils';

let chain = Promise.resolve();

addPublicCommands({
  DownloadBlob(args) {
    downloadBlob(...args);
  },
  async DownloadModeBrowser(args) {
    const browserOpts = { url: args.url, filename: args.filename };
    if (args.headers) {
      browserOpts.headers = Object.entries(args.headers).map(
        ([n, v]) => ({ name: n, value: v }),
      );
    }
    if (args.conflictAction) browserOpts.conflictAction = args.conflictAction;
    if (args.saveAs != null) browserOpts.saveAs = args.saveAs;
    if (args.method) browserOpts.method = args.method;
    if (args.body) browserOpts.body = args.body;
    const downloadId = await browser.downloads.download(browserOpts);
    return new Promise((resolve, reject) => {
      const listener = delta => {
        if (delta.id !== downloadId) return;
        if (delta.state && delta.state.current === 'complete') {
          browser.downloads.onChanged.removeListener(listener);
          resolve(downloadId);
        } else if (delta.state && delta.state.current === 'interrupted') {
          browser.downloads.onChanged.removeListener(listener);
          reject(new Error(delta.error ? delta.error.current : 'Download interrupted'));
        }
      };
      browser.downloads.onChanged.addListener(listener);
    });
  },
});

/**
 * @param {Blob|string} what
 * @param {string} name
 * @param {boolean} force
 */
export function downloadBlob(what, name, force) {
  // Frequent downloads are ignored in Chrome and possibly other browsers
  if (!force) {
    chain = chain.then(() => (downloadBlob(what, name, true), makePause(150)));
    return;
  }
  const url = isObject(what) ? URL.createObjectURL(what) : what;
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  a.click();
  if (isObject(what)) makePause(3000).then(() => URL.revokeObjectURL(url));
}
