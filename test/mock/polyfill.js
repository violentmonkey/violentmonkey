import tldRules from 'tldjs/rules.json';
import { JSDOM } from 'jsdom';

global.window = new JSDOM('').window;
global.chrome = {};
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

const domProps = Object.getOwnPropertyDescriptors(window);
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

global.__VAULT_ID__ = false;
Object.assign(global, require('#/common/safe-globals'));
Object.assign(global, require('#/injected/safe-globals-injected'));
Object.assign(global, require('#/injected/content/safe-globals-content'));
Object.assign(global, require('#/injected/web/safe-globals-web'));
