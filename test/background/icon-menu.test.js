const getListenerApi = () => ({
  addListener: jest.fn(),
  removeListener: jest.fn(),
});

function setupBrowserApis() {
  const tabsOnUpdated = getListenerApi();
  const tabsOnRemoved = getListenerApi();
  const tabsOnCreated = getListenerApi();
  const tabsOnReplaced = getListenerApi();
  const runtimeOnConnect = getListenerApi();
  const webRequestOnBeforeRequest = getListenerApi();
  global.browser.tabs.query = jest.fn(async () => []);
  global.browser.tabs.get = jest.fn(async id => ({ id, url: 'https://example.com/' }));
  global.browser.tabs.update = jest.fn(async () => ({}));
  global.browser.tabs.create = jest.fn(async () => ({ id: 55 }));
  global.browser.tabs.remove = jest.fn(async () => {});
  global.browser.tabs.onUpdated = tabsOnUpdated;
  global.browser.tabs.onRemoved = tabsOnRemoved;
  global.browser.tabs.onCreated = tabsOnCreated;
  global.browser.tabs.onReplaced = tabsOnReplaced;
  global.browser.runtime.sendMessage = jest.fn(async () => ({}));
  global.browser.runtime.onConnect = runtimeOnConnect;
  global.browser.webRequest = {
    onBeforeRequest: webRequestOnBeforeRequest,
  };
  global.chrome.i18n = {
    getMessage: jest.fn((name) => name),
  };
  global.chrome.action = {
    setIcon: jest.fn(),
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
    setTitle: jest.fn(),
  };
  const contextMenuOnClicked = getListenerApi();
  global.chrome.contextMenus = {
    create: jest.fn((opts, cb) => cb?.()),
    update: jest.fn((id, opts, cb) => cb?.()),
    removeAll: jest.fn(cb => cb?.()),
    onClicked: contextMenuOnClicked,
  };
  return {
    contextMenus: global.chrome.contextMenus,
  };
}

describe('icon menu handlers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('updateScriptsInTab does not throw when badge state is empty (worker restart case)', () => {
    jest.resetModules();
    setupBrowserApis();
    const { handleHotkeyOrMenu } = require('@/background/utils/icon');
    const { commands } = require('@/background/utils/init');
    commands.CheckUpdate = jest.fn();
    expect(() => handleHotkeyOrMenu('updateScriptsInTab', { id: 42 })).not.toThrow();
    expect(commands.CheckUpdate).not.toHaveBeenCalled();
  });

  test('updateScriptsInTab triggers update for script ids when badge state exists', () => {
    jest.resetModules();
    setupBrowserApis();
    const { handleHotkeyOrMenu, badges } = require('@/background/utils/icon');
    const { commands } = require('@/background/utils/init');
    commands.CheckUpdate = jest.fn();
    badges[42] = {
      [IDS]: new Set([10, 11]),
    };
    handleHotkeyOrMenu('updateScriptsInTab', { id: 42 });
    expect(commands.CheckUpdate).toHaveBeenCalledWith([10, 11]);
  });

  test('setIcon falls back to path-only payload when imageData is unavailable', async () => {
    jest.resetModules();
    setupBrowserApis();
    const RealImage = global.Image;
    global.Image = class BrokenImage {
      constructor() {
        this.width = 0;
        this.height = 0;
      }

      set src(value) {
        this._src = value;
        setTimeout(() => this.onload?.(), 0);
      }
    };
    try {
      const { setBadge } = require('@/background/utils/icon');
      global.chrome.action.setIcon.mockClear();
      setBadge([10], true, {
        tab: { id: 77, url: 'https://example.com/' },
        [kFrameId]: 0,
        [kTop]: true,
      });
      await new Promise(resolve => setTimeout(resolve, 25));
      const payload = global.chrome.action.setIcon.mock.calls.at(-1)?.[0];
      expect(payload).toBeTruthy();
      expect(payload.path).toBeTruthy();
      expect(payload.imageData).toBeUndefined();
    } finally {
      global.Image = RealImage;
    }
  });

  test('setBadge always provides a badge background color before options init settles', () => {
    jest.resetModules();
    setupBrowserApis();
    const { setBadge } = require('@/background/utils/icon');
    global.chrome.action.setBadgeBackgroundColor.mockClear();
    setBadge([10], true, {
      tab: { id: 78, url: 'https://example.com/' },
      [kFrameId]: 0,
      [kTop]: true,
    });
    const payload = global.chrome.action.setBadgeBackgroundColor.mock.calls.at(-1)?.[0];
    expect(payload).toBeTruthy();
    expect(payload.color).toBeTruthy();
  });

  test('getFailureReason honors option fallback before icon init settles', () => {
    jest.resetModules();
    setupBrowserApis();
    const { getFailureReason } = require('@/background/utils/icon');
    const [, reason] = getFailureReason('https://example.com/', { [INJECT]: null });
    expect(reason).not.toBe(IS_APPLIED);
  });

  test('badge color invocation errors do not retry without callback', () => {
    jest.resetModules();
    setupBrowserApis();
    global.chrome.action.setBadgeBackgroundColor.mockImplementation(() => {
      throw new TypeError('Error in invocation of action.setBadgeBackgroundColor');
    });
    const { setBadge } = require('@/background/utils/icon');
    expect(() => setBadge([10], true, {
      tab: { id: 79, url: 'https://example.com/' },
      [kFrameId]: 0,
      [kTop]: true,
    })).not.toThrow();
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledTimes(1);
  });

  test('context menu init clears existing items before recreating ids', async () => {
    jest.resetModules();
    const { contextMenus } = setupBrowserApis();
    expect(() => require('@/background/utils/icon')).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(contextMenus.removeAll).toHaveBeenCalled();
    expect(contextMenus.create).toHaveBeenCalled();
  });

  test('context menu init retries duplicate id creation by removing stale entries', async () => {
    jest.resetModules();
    const { contextMenus } = setupBrowserApis();
    const duplicateId = 'SkipScripts';
    let injectedDuplicate = false;
    contextMenus.create.mockImplementation((opts, cb) => {
      if (!injectedDuplicate && opts.id === duplicateId) {
        injectedDuplicate = true;
        global.chrome.runtime.lastError = { message: `Cannot create item with duplicate id ${duplicateId}` };
        cb?.();
        global.chrome.runtime.lastError = null;
        return;
      }
      cb?.();
    });
    contextMenus.remove = jest.fn((id, cb) => cb?.());
    expect(() => require('@/background/utils/icon')).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(contextMenus.remove).toHaveBeenCalledWith(duplicateId, expect.any(Function));
    expect(contextMenus.create.mock.calls.filter(([opts]) => opts.id === duplicateId)).toHaveLength(2);
  });
});
