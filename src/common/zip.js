import { memoize } from './util';

function loadJS(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = resolve;
    el.onerror = reject;
    document.body.append(el);
  });
}

const loadZip = memoize(async () => {
  await loadJS('/public/lib/zip-no-worker.min.js');
  const { zip } = window;
  const workerScripts = ['/public/lib/z-worker.js'];
  zip.configure({
    workerScripts: {
      deflate: workerScripts,
      inflate: workerScripts,
    },
  });
  return zip;
});

export default loadZip;
