import { memoize } from './util';

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject();
    document.body.append(script);
  });
}

const loadZip = memoize(async () => {
  await loadScript('/public/lib/zip.js/zip.js');
  return window.zip;
});

export default loadZip;
