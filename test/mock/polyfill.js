import tldRules from 'tldjs/rules.json';
import { JSDOM } from 'jsdom';

global.window = global;

global.browser = {
  storage: {
    local: {
      get() {
        return Promise.resolve({
          'dat:tldRules': tldRules,
        });
      },
      set() {
        return Promise.resolve();
      },
    },
  },
  runtime: {
    getURL: path => path,
  },
};

const domProps = Object.getOwnPropertyDescriptors(new JSDOM('').window);
for (const k of Object.keys(domProps)) {
  if (k.endsWith('Storage') || k in global) delete domProps[k];
}
delete domProps.performance;
Object.defineProperties(global, domProps);
global.Response = { prototype: {} };

global.URL = {
  _cache: {},
  createObjectURL(blob) {
    const blobUrl = `blob:${Math.random()}`;
    URL._cache[blobUrl] = blob;
    return blobUrl;
  },
};
