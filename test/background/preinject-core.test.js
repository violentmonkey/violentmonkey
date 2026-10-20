
jest.mock('@/common/browser-scripts-api', () => ({ executeScript: jest.fn(async () => {}) }));
jest.mock('@/background/utils/dnr', () => ({}));
jest.mock('@/background/utils/notifications', () => ({}));
jest.mock('@/background/utils/options', () => ({ hookOptionsInit: jest.fn() }));
jest.mock('@/background/utils/page-menu-commands', () => ({}));
jest.mock('@/background/utils/permissions', () => ({ onPermissionChanged: { add: () => {} } }));
jest.mock('@/background/utils/preinject-prepare', () => ({ prepare: jest.fn() }));
jest.mock('@/background/utils/requests', () => ({}));
jest.mock('@/background/utils/requests-core', () => ({}));
jest.mock('@/background/utils/session-data', () => ({ skippedTabs: {} }));
jest.mock('@/background/utils/storage-cache', () => ({}));
jest.mock('@/background/utils/tabs', () => ({
  tabsOnRemoved: { addListener: () => {}, removeListener: () => {} },
}));
jest.mock('@/background/utils/values', () => ({}));

let originalWebRequest;
let originalTabGet;
let originalReplaced;

const event = () => ({ addListener: jest.fn(), removeListener: jest.fn() });
function load(webRequest) {
  browser.webRequest = webRequest;
  let api;
  jest.isolateModules(() => {
    api = require('@/background/utils/preinject-core');
    require('@/background/utils/options').hookOptionsInit.mock.calls.at(-1)[0]({ isApplied: true });
    api = {
      ...api,
      prepare: require('@/background/utils/preinject-prepare').prepare,
      executeScript: require('@/common/browser-scripts-api').executeScript,
      codeKey: require('@/common/consts').__CODE,
    };
  });
  return api;
}

beforeEach(() => {
  originalWebRequest = browser.webRequest;
  originalTabGet = browser.tabs.get;
  originalReplaced = browser.tabs.onReplaced;
  browser.tabs.onReplaced = event();
  jest.clearAllMocks();
});

afterEach(() => {
  browser.webRequest = originalWebRequest;
  browser.tabs.get = originalTabGet;
  browser.tabs.onReplaced = originalReplaced;
});

test('starts without optional webRequest interfaces', () => {
  expect(() => load(undefined)).not.toThrow();
});

test('starts with header events but without option enums or tab replacement events', () => {
  browser.tabs.onReplaced = undefined;
  expect(() => load({ onSendHeaders: event(), onHeadersReceived: event() })).not.toThrow();
});

test('keeps normal injection available when optional early-header listeners throw', () => {
  const unsupported = () => { throw new Error('Not implemented'); };
  const webRequest = {
    onSendHeaders: { addListener: unsupported },
    onHeadersReceived: { addListener: unsupported },
  };
  expect(() => load(webRequest)).not.toThrow();
});

test('keeps injection caches separate for tabs and frames sharing a URL', () => {
  const { getKey } = load({ onHeadersReceived: event(), OnHeadersReceivedOptions: {} });
  const url = 'https://example.org/';
  expect(new Set([
    getKey(url, true, 1), getKey(url, true, 2), getKey(url, false, 1),
  ]).size).toBe(3);
});

test('prepares with the actual tab context instead of request header metadata', async () => {
  const webRequest = { onSendHeaders: event(), onHeadersReceived: event(), OnHeadersReceivedOptions: {} };
  const context = { id: 12, incognito: false, cookieStoreId: 'firefox-container-3' };
  browser.tabs.get = jest.fn(async () => context);
  const api = load(webRequest);
  const sendHeaders = webRequest.onSendHeaders.addListener.mock.calls[0][0];
  const url = 'https://example.org/';
  await sendHeaders({ url, tabId: 12, frameId: 0 });
  expect(api.prepare).toHaveBeenCalledWith(api.getKey(url, true, 12), url, true, false, context);
});

test('uses a valid execution time for an explicitly activated content script', () => {
  const api = load({ onHeadersReceived: event(), OnHeadersReceivedOptions: {} });
  api.cache.put('scr:1', {
    key: { data: 'selected-script' }, [api.codeKey]: ['manual();'], runAt: 'context-menu', meta: {},
  });
  api.injectContentRealm([[1, 'selected-script']], 12, 0);
  expect(api.executeScript).toHaveBeenCalledWith(12, 'manual();', 'document_end', 0);
});
