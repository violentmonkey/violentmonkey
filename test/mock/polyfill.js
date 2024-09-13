global.chrome =
global.browser = {
  storage: {
    local: {
      get() {
        return Promise.resolve({});
      },
      set() {
        return Promise.resolve();
      },
    },
  },
  extension: {
    isAllowedFileSchemeAccess: () => false,
  },
  runtime: {
    getURL: path => path,
    getManifest: () => ({
      icons: { 16: '' },
      options_ui: {},
    }),
    getPlatformInfo: async () => ({}),
  },
  tabs: {
    onRemoved: { addListener: () => {} },
    onReplaced: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
  },
  windows: {
    getAll: () => [{}],
    getCurrent: () => ({}),
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
Object.assign(URL, {
  blobCache: {},
  createObjectURL(blob) {
    const blobUrl = `blob:${Math.random()}`;
    URL.blobCache[blobUrl] = blob;
    return blobUrl;
  },
});
Object.assign(global, require('@/common/safe-globals-shared'));
Object.assign(global, require('@/common/safe-globals'));
Object.assign(global, require('@/injected/safe-globals'));
Object.assign(global, require('@/injected/content/safe-globals'));
Object.assign(global, require('@/injected/web/safe-globals'));
