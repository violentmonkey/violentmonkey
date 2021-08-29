import { memoize } from './util';

/**
 * A primitive but GC-friendly polyfill for Chrome < 69, FF < 62
 * TODO: properly transpile zip.js using webpack/gulp and our .browserslistrc
 */
function initPolyfills() {
  const arrayFlatInto = (res, arr, depth) => {
    arr.forEach(item => {
      if (depth >= 1 && Array.isArray(item)) {
        arrayFlatInto(res, item, depth - 1);
      } else {
        res.push(item);
      }
    });
    return res;
  };
  Object.assign(Array.prototype, {
    flat(depth = 1) {
      return depth >= 1 && this.some(Array.isArray)
        ? arrayFlatInto([], this, depth)
        : this.slice();
    },
  });
}

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
  const workerScripts = [
    ![].flat && URL.createObjectURL(new Blob([`(${initPolyfills})()`])),
    '/public/lib/z-worker.js',
  ].filter(Boolean);
  zip.configure({
    workerScripts: {
      deflate: workerScripts,
      inflate: workerScripts,
    },
  });
  return zip;
});

export default loadZip;
