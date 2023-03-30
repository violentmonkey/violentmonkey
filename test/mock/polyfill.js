import tldRules from 'tldjs/rules.json';

global.chrome =
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
    getManifest: () => ({
      icons: { 16: '' },
      options_ui: {},
    }),
  },
};
if (!window.Response) window.Response = { prototype: {} };
const domProps = Object.getOwnPropertyDescriptors(window);
for (const k of Object.keys(domProps)) {
  // Skipping ***Storage and native global methods
  if (k.endsWith('Storage') || /^[a-z]/.test(k) && (k in global)) {
    delete domProps[k];
  }
}
Object.defineProperties(global, domProps);
delete MessagePort.prototype.onmessage; // to avoid hanging
global.PAGE_MODE_HANDSHAKE = 123;
global.VAULT_ID = false;
Object.assign(global, require('@/common/safe-globals-shared'));
Object.assign(global, require('@/common/safe-globals'));
Object.assign(global, require('@/injected/safe-globals'));
Object.assign(global, require('@/injected/content/safe-globals'));
Object.assign(global, require('@/injected/web/safe-globals'));
