jest.mock('@/common/browser-scripts-api', () => ({}));
jest.mock('@/background/utils/db', () => ({}));
jest.mock('@/background/utils/icon', () => ({ getFailureReason: () => [] }));
jest.mock('@/background/utils/init', () => {
  const commands = { GetTabDomain: () => ({ domain: 'example.org' }) };
  return {
    commands,
    addOwnCommands: obj => Object.assign(commands, obj),
    addPublicCommands: obj => Object.assign(commands, obj),
  };
});
jest.mock('@/background/utils/options', () => ({
  getOption: () => true,
  hookOptions: () => {},
  hookOptionsInit: jest.fn(),
}));
jest.mock('@/background/utils/session-data', () => ({ badges: { 10: { inject: true } } }));
jest.mock('@/background/utils/storage', () => ({ onStorageChanged: () => {} }));
jest.mock('@/background/utils/tabs', () => ({
  tabsOnUpdated: global.browser.tabs.onUpdated,
  tabsOnActivated: global.browser.tabs.onActivated,
  tabsOnRemoved: global.browser.tabs.onRemoved,
  injectableRe: /^https?:/,
  forEachTab: () => {},
}));
jest.mock('@/background/utils/mcp', () => ({
  MCP_CONNECT_URL: 'https://mcp.example/',
  requestMcpConnection: url => url === 'https://mcp.example/',
  openMcpAuthorization: jest.fn(),
}));
jest.mock('@/background/utils/script', () => ({
  aliveScripts: [{
    props: { id: 1 },
    config: { enabled: 1 },
    custom: {},
    meta: { name: 'manual', runAt: 'context-menu' },
  }],
}));
jest.mock('@/background/utils/ua', () => ({}));
jest.mock('@/background/utils/url', () => ({}));
jest.mock('@/background/utils/tester', () => ({
  testBlacklist: () => false,
  testScript: () => true,
  testScriptContext: () => true,
}));

const event = () => ({ addListener: jest.fn(), removeListener: jest.fn() });
const unsupported = () => { throw new Error('Not implemented'); };
let previous;
let menuItems;

beforeEach(() => {
  previous = {
    webRequest: browser.webRequest,
    onConnect: browser.runtime.onConnect,
    onActivated: browser.tabs.onActivated,
    onUpdated: browser.tabs.onUpdated,
    onRemoved: browser.tabs.onRemoved,
    query: browser.tabs.query,
    sendMessage: browser.tabs.sendMessage,
    focus: browser.windows.onFocusChanged,
    contextMenus: chrome.contextMenus,
    i18n: chrome.i18n,
    manifest: global.extensionManifest,
  };
  browser.webRequest = { onBeforeRequest: event() };
  browser.runtime.onConnect = event();
  browser.tabs.onActivated = event();
  browser.tabs.onUpdated = event();
  browser.tabs.onRemoved = event();
  browser.tabs.query = async () => [{ id: 10, url: 'https://example.org/' }];
  browser.tabs.sendMessage = jest.fn(async () => {});
  browser.windows.onFocusChanged = event();
  menuItems = new Map();
  chrome.contextMenus = {
    create: item => menuItems.set(item.id, item),
    remove: id => menuItems.delete(id),
    update: (id, change) => Object.assign(menuItems.get(id) || {}, change),
    onClicked: event(),
  };
  chrome.i18n = { getMessage: key => key };
  global.extensionManifest = { browser_action: { default_popup: 'popup/index.html' } };
});

afterEach(() => {
  browser.webRequest = previous.webRequest;
  browser.runtime.onConnect = previous.onConnect;
  browser.tabs.onActivated = previous.onActivated;
  browser.tabs.onUpdated = previous.onUpdated;
  browser.tabs.onRemoved = previous.onRemoved;
  browser.tabs.query = previous.query;
  browser.tabs.sendMessage = previous.sendMessage;
  browser.windows.onFocusChanged = previous.focus;
  chrome.contextMenus = previous.contextMenus;
  chrome.i18n = previous.i18n;
  global.extensionManifest = previous.manifest;
});

test.each([
  ['missing group', undefined],
  ['missing event', {}],
  ['missing method', { onBeforeRequest: {} }],
  ['throwing method', { onBeforeRequest: { addListener: unsupported } }],
])('keeps popup initialization usable with a %s webRequest API', async (name, webRequest) => {
  browser.webRequest = webRequest;
  let api;
  expect(() => {
    jest.isolateModules(() => {
      api = require('@/background/utils/popup-tracker');
    });
  }).not.toThrow();
  const [, data] = await api.initPopup();
  expect(data).toEqual({ domain: 'example.org', tab: { id: 10, url: 'https://example.org/' } });
});

test('prefetches popup state through supported webRequest hooks', async () => {
  jest.isolateModules(() => {
    require('@/background/utils/popup-tracker');
  });
  browser.webRequest.onBeforeRequest.addListener.mock.calls[0][0]();
  await Promise.resolve();
  await Promise.resolve();
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(10, {
    cmd: 'PopupShown', data: true,
  }, undefined);
});

test.each([
  ['missing group', undefined],
  ['missing event', {}],
  ['missing method', { onBeforeRequest: {} }],
  ['throwing method', { onBeforeRequest: { addListener: unsupported } }],
])('keeps installer commands registered with a %s webRequest API', (name, webRequest) => {
  browser.webRequest = webRequest;
  let commands;
  expect(() => {
    jest.isolateModules(() => {
      require('@/background/utils/tab-redirector');
      ({ commands } = require('@/background/utils/init'));
    });
  }).not.toThrow();
  expect(typeof commands.ConfirmInstall).toBe('function');
});

test('preserves installer interception when webRequest is supported', () => {
  let authorize;
  jest.isolateModules(() => {
    require('@/background/utils/tab-redirector');
    authorize = require('@/background/utils/mcp').openMcpAuthorization;
  });
  const callbacks = browser.webRequest.onBeforeRequest.addListener.mock.calls;
  expect(callbacks).toHaveLength(2);
  expect(callbacks[0][0]({ method: 'POST' })).toBeUndefined();
  expect(callbacks[1][0]({ tabId: 10, url: 'https://mcp.example/' })).toEqual({
    redirectUrl: 'javascript:void 0',
  });
  expect(authorize).toHaveBeenCalledWith(10);
});

test.each([
  ['missing event', undefined],
  ['missing methods', {}],
  ['throwing methods', { addListener: unsupported, removeListener: unsupported }],
])('keeps page-menu commands usable with %s for window focus', (name, focus) => {
  browser.windows.onFocusChanged = focus;
  let api;
  let optionChanged;
  jest.isolateModules(() => {
    api = require('@/background/utils/page-menu-commands');
    optionChanged = require('@/background/utils/options').hookOptionsInit.mock.calls[0][0];
  });
  expect(() => optionChanged({ pageMenuCommands: true }, true)).not.toThrow();
  const data = {};
  api.addMenuConfig(data);
  expect(data.useMenu).toBe(true);
  expect(menuItems.has('cmdRoot')).toBe(true);
  expect(() => optionChanged({ pageMenuCommands: false }, true)).not.toThrow();
});

test.each(['onClicked', 'onFocusChanged', 'onActivated', 'onUpdated'])(
  'keeps manual menu commands registered when %s throws during subscription', name => {
    const owner = name === 'onClicked' ? chrome.contextMenus
      : name === 'onFocusChanged' ? browser.windows : browser.tabs;
    owner[name] = { addListener: unsupported };
    let commands;
    expect(() => {
      jest.isolateModules(() => {
        require('@/background/utils/context-menu-scripts');
        ({ commands } = require('@/background/utils/init'));
      });
    }).not.toThrow();
    expect(typeof commands.RunContextMenuScript).toBe('function');
  }
);

test('keeps manual popup execution available when browser menu creation throws', async () => {
  chrome.contextMenus.create = unsupported;
  let api;
  jest.isolateModules(() => {
    api = require('@/background/utils/context-menu-scripts');
  });
  await expect(api.rebuildContextMenuScripts({
    id: 10, url: 'https://example.org/',
  })).resolves.toBeUndefined();
});

test('keeps page-menu initialization usable when browser menu creation throws', () => {
  chrome.contextMenus.create = unsupported;
  let optionChanged;
  jest.isolateModules(() => {
    require('@/background/utils/page-menu-commands');
    optionChanged = require('@/background/utils/options').hookOptionsInit.mock.calls[0][0];
  });
  expect(() => optionChanged({ pageMenuCommands: true }, true)).not.toThrow();
});
