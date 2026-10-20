jest.mock('@/common/browser', () => global.browser);
jest.mock('@/common/messaging-sw', () => ({}));
jest.mock('@/background/utils/broadcast', () => ({}));
jest.mock('@/background/utils/db', () => ({
  dbKeys: new Map(), sizesPrefixRe: /^(?:code:|req:|val:)/,
}));
jest.mock('@/background/utils/init', () => ({
  init: Promise.resolve(), incognitoAllowed: true, addOwnCommands: () => {},
}));
jest.mock('@/background/utils/script', () => ({
  scriptSiteVisited: {}, updateScriptMap: () => false,
}));
jest.mock('@/background/utils/session-data', () => ({ scriptSizes: {}, flushSession: () => {} }));
jest.mock('@/background/utils/values', () => ({}));

test('decodes another extension context\'s source updates before cached reads', async () => {
  const originalMV3 = __.MV3;
  const originalOnChanged = browser.storage.local.onChanged;
  const originalOnConnect = browser.runtime.onConnect;
  const persisted = {};
  let onChanged;
  jest.useFakeTimers();
  __.MV3 = true;
  browser.storage.local.onChanged = { addListener: fn => { onChanged = fn; } };
  browser.runtime.onConnect = { addListener: () => {} };
  jest.spyOn(browser.storage.local, 'get').mockImplementation(async keys => (
    Object.fromEntries((keys || Object.keys(persisted)).filter(key => key in persisted)
      .map(key => [key, JSON.parse(JSON.stringify(persisted[key]))]))
  ));
  jest.spyOn(browser.storage.local, 'set').mockImplementation(async data => {
    Object.assign(persisted, JSON.parse(JSON.stringify(data)));
    onChanged(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { newValue: value }])));
  });
  let storage;
  let other;
  let clearStorageCache;
  try {
    jest.isolateModules(() => {
      ({ clearStorageCache } = require('@/background/utils/storage-cache'));
      storage = require('@/background/utils/storage').default;
      other = require('@/background/utils/storage-source').default(browser.storage.local);
    });
    await Promise.resolve();
    await storage.code.setOne(1, "original('', '');");
    expect(await storage.code.getOne(1)).toBe("original('', '');");
    await other.set({ 'code:1': "updated('', '');" });
    expect(await storage.code.getOne(1)).toBe("updated('', '');");
    clearStorageCache();
    expect(await storage.code.getOne(1)).toBe("updated('', '');");
    expect(persisted['code:1']).toMatchObject({ vmSource: 1 });
  } finally {
    __.MV3 = originalMV3;
    browser.storage.local.onChanged = originalOnChanged;
    browser.runtime.onConnect = originalOnConnect;
    jest.restoreAllMocks();
    jest.useRealTimers();
  }
});
