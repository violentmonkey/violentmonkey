import {
  cleanupStaleUserScriptsAtStartup,
  cleanupRegisteredUserScripts,
  ensureMainWorldBridgeRegistration,
  executeScriptInTab,
  getUserScriptsHealth,
  registerUserScriptOnce,
} from '@/background/utils/tabs';
import { commands } from '@/background/utils/init';
import { browser as browserApi } from '@/common/consts';

const { tabs } = browserApi;
const browser = global.browser;
const MAIN_BRIDGE_INIT_FUNC_NAME = process.env.INIT_FUNC_NAME || '**VMInitInjection**';

let oldTabsExecuteScript;
let oldTabsGet;
let oldBrowserScripting;
let oldChromeScripting;
let oldChromeUserScripts;
let oldBrowserUserScripts;
let oldRuntimeLastError;
let oldRuntimeOnInstalled;
let oldRuntimeOnStartup;

beforeEach(() => {
  oldTabsExecuteScript = tabs.executeScript;
  oldTabsGet = tabs.get;
  oldBrowserScripting = browser.scripting;
  oldChromeScripting = chrome.scripting;
  oldChromeUserScripts = chrome.userScripts;
  oldBrowserUserScripts = browser.userScripts;
  oldRuntimeLastError = chrome.runtime.lastError;
  oldRuntimeOnInstalled = browser.runtime.onInstalled;
  oldRuntimeOnStartup = browser.runtime.onStartup;
  chrome.runtime.lastError = null;
});

afterEach(() => {
  jest.useRealTimers();
  tabs.executeScript = oldTabsExecuteScript;
  tabs.get = oldTabsGet;
  browser.scripting = oldBrowserScripting;
  chrome.scripting = oldChromeScripting;
  chrome.userScripts = oldChromeUserScripts;
  browser.userScripts = oldBrowserUserScripts;
  chrome.runtime.lastError = oldRuntimeLastError;
  browser.runtime.onInstalled = oldRuntimeOnInstalled;
  browser.runtime.onStartup = oldRuntimeOnStartup;
});

test('executeScriptInTab uses tabs.executeScript when available', async () => {
  const result = [1];
  tabs.executeScript = jest.fn(async () => result);
  const options = { code: '1' };
  const res = await executeScriptInTab(12, options);
  expect(tabs.executeScript).toHaveBeenCalledWith(12, options);
  expect(res).toBe(result);
});

test('executeScriptInTab maps callback scripting.executeScript results', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([
      { result: 'a' },
      { result: 'b' },
    ])),
  };
  const res = await executeScriptInTab(13, { code: '1 + 1' });
  expect(chrome.scripting.executeScript).toHaveBeenCalled();
  expect(res).toEqual(['a', 'b']);
});

test('executeScriptInTab supports callback-style chrome.scripting.executeScript fallback', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 7 }])),
  };
  const res = await executeScriptInTab(14, { code: '3 + 4' });
  expect(chrome.scripting.executeScript).toHaveBeenCalled();
  expect(res).toEqual([7]);
});

test('executeScriptInTab rejects when callback-style chrome.scripting reports runtime error', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => {
      chrome.runtime.lastError = { message: 'boom' };
      cb();
      chrome.runtime.lastError = null;
    }),
  };
  await expect(executeScriptInTab(15, { code: '0' })).rejects.toThrow('boom');
});

test('executeScriptInTab falls back to callback API if promise-like API throws', async () => {
  tabs.executeScript = undefined;
  browser.scripting = {
    executeScript: jest.fn(() => {
      throw new Error('bad promise api');
    }),
  };
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 9 }])),
  };
  const res = await executeScriptInTab(16, { code: '4 + 5' });
  expect(browser.scripting.executeScript).toHaveBeenCalled();
  expect(chrome.scripting.executeScript).toHaveBeenCalled();
  expect(res).toEqual([9]);
});

test('executeScriptInTab maps MV3 frame and runAt options to scripting target details', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  let details;
  chrome.scripting = {
    executeScript: jest.fn((injectedDetails, cb) => {
      details = injectedDetails;
      cb([{ result: true }]);
    }),
  };
  const res = await executeScriptInTab(17, {
    code: '1',
    [kFrameId]: 7,
    [RUN_AT]: 'document_start',
  });
  expect(details).toEqual(expect.objectContaining({
    target: { tabId: 17, frameIds: [7] },
    injectImmediately: true,
    args: ['1'],
    func: expect.any(Function),
  }));
  expect(res).toEqual([true]);
});

test('executeScriptInTab maps MV3 allFrames and files options', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  let details;
  chrome.scripting = {
    executeScript: jest.fn((injectedDetails, cb) => {
      details = injectedDetails;
      cb([{ result: 'ok' }]);
    }),
  };
  const res = await executeScriptInTab(18, {
    allFrames: true,
    files: ['a.js', 'b.js'],
  });
  expect(details).toEqual(expect.objectContaining({
    target: { tabId: 18, allFrames: true },
    files: ['a.js', 'b.js'],
  }));
  expect(res).toEqual(['ok']);
});

test('executeScriptInTab rejects when no compatible injection API exists', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = undefined;
  await expect(executeScriptInTab(19, { code: '1' }))
    .rejects.toThrow('tabs.executeScript and scripting.executeScript are unavailable');
});

test('executeScriptInTab rejects MV3 string-code fallback when no userscripts path is used', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    chrome.scripting = {
      executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
    };
    await expect(executeScriptInTab(19, { code: '1 + 1' }))
      .rejects.toThrow('MV3 string-code fallback is disabled');
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('executeScriptInTab keeps top-frame target by default in MV3', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  let details;
  chrome.scripting = {
    executeScript: jest.fn((injectedDetails, cb) => {
      details = injectedDetails;
      cb([{ result: 'top' }]);
    }),
  };
  const res = await executeScriptInTab(20, { code: '2 + 2' });
  expect(details).toEqual(expect.objectContaining({
    target: { tabId: 20 },
    args: ['2 + 2'],
  }));
  expect(res).toEqual(['top']);
});

test('executeScriptInTab forwards world/func args to scripting API', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  let details;
  chrome.scripting = {
    executeScript: jest.fn((injectedDetails, cb) => {
      details = injectedDetails;
      cb([{ result: { ok: true } }]);
    }),
  };
  const res = await executeScriptInTab(20, {
    [kFrameId]: 3,
    world: 'MAIN',
    func: (a, b) => a + b,
    args: [2, 3],
  });
  expect(details).toEqual(expect.objectContaining({
    target: { tabId: 20, frameIds: [3] },
    world: 'MAIN',
    func: expect.any(Function),
    args: [2, 3],
  }));
  expect(res).toEqual([{ ok: true }]);
});

test('executeScriptInTab does not force immediate injection for document_end and document_idle', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  const seen = [];
  chrome.scripting = {
    executeScript: jest.fn((injectedDetails, cb) => {
      if (cb) {
        seen.push(injectedDetails);
        cb([{ result: true }]);
      }
    }),
  };
  await executeScriptInTab(21, { code: '1', [RUN_AT]: 'document_end' });
  await executeScriptInTab(21, { code: '1', [RUN_AT]: 'document_idle' });
  expect(seen).toHaveLength(2);
  seen.forEach(details => {
    expect(details.target).toEqual({ tabId: 21 });
    expect(details.injectImmediately).toBeUndefined();
  });
});

test('registerUserScriptOnce registers one-shot script and schedules cleanup', async () => {
  jest.useFakeTimers();
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/path/index.html?x=1' }));
  const register = jest.fn(async () => {});
  const unregister = jest.fn(async () => {});
  chrome.userScripts = { register, unregister };
  browser.userScripts = chrome.userScripts;
  const ok = await registerUserScriptOnce(22, {
    code: 'window.__vm = 1;',
    [RUN_AT]: 'document_start',
    [kFrameId]: 0,
  });
  expect(ok).toBe(true);
  expect(register).toHaveBeenCalledTimes(1);
  const [{ id, matches, persistAcrossSessions }] = register.mock.calls[0][0];
  expect(id).toMatch(/^vm-one-shot-/);
  expect(matches).toEqual(['https://example.com/path/index.html*']);
  expect(persistAcrossSessions).toBeUndefined();
  jest.advanceTimersByTime(30e3);
  await Promise.resolve();
  expect(unregister).toHaveBeenCalledWith({ ids: [id] });
  jest.useRealTimers();
});

test('registerUserScriptOnce omits world for non-MAIN userscripts execution', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/path/index.html?x=1' }));
  const register = jest.fn(async () => {});
  chrome.userScripts = { register, unregister: jest.fn(async () => {}) };
  browser.userScripts = chrome.userScripts;
  const ok = await registerUserScriptOnce(22, {
    code: 'window.__vm = 1;',
    [kFrameId]: 0,
    world: 'ISOLATED',
  });
  expect(ok).toBe(true);
  expect(register).toHaveBeenCalledTimes(1);
  expect(register.mock.calls[0][0][0].world).toBeUndefined();
});

test('registerUserScriptOnce returns false for unsupported URL', async () => {
  tabs.get = jest.fn(async () => ({ url: 'chrome://newtab/' }));
  const register = jest.fn(async () => {});
  chrome.userScripts = { register, unregister: jest.fn(async () => {}) };
  browser.userScripts = chrome.userScripts;
  const ok = await registerUserScriptOnce(23, {
    code: '1',
    [kFrameId]: 0,
  });
  expect(ok).toBe(false);
  expect(register).not.toHaveBeenCalled();
});

test('cleanupRegisteredUserScripts unregisters tracked IDs for a tab', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/path' }));
  const register = jest.fn(async () => {});
  const unregister = jest.fn(async () => {});
  chrome.userScripts = { register, unregister };
  browser.userScripts = chrome.userScripts;
  await registerUserScriptOnce(26, { code: '1', [kFrameId]: 0 });
  await registerUserScriptOnce(26, { code: '2', [kFrameId]: 0 });
  const firstId = register.mock.calls[0][0][0].id;
  const secondId = register.mock.calls[1][0][0].id;
  await cleanupRegisteredUserScripts(26, [firstId]);
  expect(unregister).toHaveBeenNthCalledWith(1, { ids: [firstId] });
  await cleanupRegisteredUserScripts(26);
  expect(unregister).toHaveBeenNthCalledWith(2, { ids: [secondId] });
  await cleanupRegisteredUserScripts(26);
  expect(unregister).toHaveBeenCalledTimes(2);
});

test('cleanupStaleUserScriptsAtStartup unregisters stale one-shot scripts only once per API instance', async () => {
  const getScripts = jest.fn(async () => ([
    { id: 'vm-one-shot-1' },
    { id: 'custom-keep' },
    { id: 'vm-one-shot-2' },
  ]));
  const unregister = jest.fn(async () => {});
  chrome.userScripts = {
    getScripts,
    unregister,
  };
  browser.userScripts = chrome.userScripts;
  const first = await cleanupStaleUserScriptsAtStartup();
  const second = await cleanupStaleUserScriptsAtStartup();
  expect(first).toBe(true);
  expect(second).toBe(true);
  expect(getScripts).toHaveBeenCalledTimes(1);
  expect(unregister).toHaveBeenCalledWith({ ids: ['vm-one-shot-1', 'vm-one-shot-2'] });
});

test('executeScriptInTab prefers userScripts path when tryUserScripts is enabled', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/page' }));
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
  };
  chrome.userScripts = {
    register: jest.fn(async () => {}),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(24, {
    code: 'window.__vm = true;',
    tryUserScripts: true,
    [kFrameId]: 0,
  });
  expect(chrome.userScripts.register).toHaveBeenCalledTimes(1);
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(res).toEqual([true]);
});

test('executeScriptInTab uses userScripts.execute when available', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
  };
  chrome.userScripts = {
    execute: jest.fn(async () => [{ result: 'us-ok' }]),
    register: jest.fn(async () => {}),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(24, {
    code: 'window.__vm = true;',
    tryUserScripts: true,
    [kFrameId]: 7,
    [RUN_AT]: 'document_start',
  });
  expect(chrome.userScripts.execute).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 24, frameIds: [7] },
    injectImmediately: true,
    js: [{ code: 'window.__vm = true;' }],
  }));
  expect(chrome.userScripts.register).not.toHaveBeenCalled();
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(res).toEqual(['us-ok']);
});

test('executeScriptInTab omits world for non-MAIN userscripts execution', async () => {
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
  };
  chrome.userScripts = {
    execute: jest.fn(async () => [{ result: 'us-ok' }]),
    register: jest.fn(async () => {}),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(24, {
    code: 'window.__vm = true;',
    tryUserScripts: true,
    [kFrameId]: 0,
    world: 'ISOLATED',
  });
  const call = chrome.userScripts.execute.mock.calls[0][0];
  expect(call.world).toBeUndefined();
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(res).toEqual(['us-ok']);
});

test('executeScriptInTab prefers userScripts.execute over register for immediate top-frame injection', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/page' }));
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
  };
  chrome.userScripts = {
    execute: jest.fn(async () => [{ result: 'us-ok' }]),
    register: jest.fn(async () => {}),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(24, {
    code: 'window.__vm = true;',
    tryUserScripts: true,
    preferRegister: true,
    [kFrameId]: 0,
  });
  expect(chrome.userScripts.register).not.toHaveBeenCalled();
  expect(chrome.userScripts.execute).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 24, frameIds: [0] },
    js: [{ code: 'window.__vm = true;' }],
  }));
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(res).toEqual(['us-ok']);
});

test('executeScriptInTab ignores preferRegister in subframes and uses userScripts.execute', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/page' }));
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
  };
  chrome.userScripts = {
    execute: jest.fn(async () => [{ result: 'frame-ok' }]),
    register: jest.fn(async () => {}),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(24, {
    code: 'window.__vm = true;',
    tryUserScripts: true,
    preferRegister: true,
    [kFrameId]: 7,
  });
  expect(chrome.userScripts.register).not.toHaveBeenCalled();
  expect(chrome.userScripts.execute).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 24, frameIds: [7] },
  }));
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(res).toEqual(['frame-ok']);
});

test('executeScriptInTab falls back when userScripts registration fails', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/page' }));
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = {
    executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
  };
  chrome.userScripts = {
    register: jest.fn(async () => {
      throw new Error('no userscripts');
    }),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(25, {
    code: 'window.__vm = false;',
    tryUserScripts: true,
    allowLegacyCodeFallback: true,
    [kFrameId]: 0,
  });
  expect(chrome.userScripts.register).toHaveBeenCalledTimes(1);
  expect(chrome.scripting.executeScript).toHaveBeenCalled();
  expect(res).toEqual(['legacy']);
});

test('executeScriptInTab does not use legacy fallback by default in MV3 when userscripts path fails', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.get = jest.fn(async () => ({ url: 'https://example.com/page' }));
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    chrome.scripting = {
      executeScript: jest.fn((details, cb) => cb([{ result: 'legacy' }])),
    };
    chrome.userScripts = {
      register: jest.fn(async () => {
        throw new Error('no userscripts');
      }),
      unregister: jest.fn(async () => {}),
    };
    browser.userScripts = chrome.userScripts;
    const res = await executeScriptInTab(25, {
      code: 'window.__vm = false;',
      tryUserScripts: true,
      [kFrameId]: 0,
    });
    expect(chrome.userScripts.register).toHaveBeenCalledTimes(1);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(res).toEqual([]);
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('executeScriptInTab can disable legacy fallback when userscripts path is unavailable', async () => {
  tabs.get = jest.fn(async () => ({ url: 'https://example.com/page' }));
  tabs.executeScript = undefined;
  browser.scripting = undefined;
  chrome.scripting = undefined;
  chrome.userScripts = {};
  browser.userScripts = chrome.userScripts;
  const res = await executeScriptInTab(26, {
    code: 'window.__vm = false;',
    tryUserScripts: true,
    allowRegisterFallback: false,
    allowLegacyCodeFallback: false,
    [kFrameId]: 0,
  });
  expect(res).toEqual([]);
});

test('getUserScriptsHealth reports disabled when userscripts permission gate blocks registration', async () => {
  chrome.userScripts = {
    register: jest.fn(async () => {
      throw new Error('Allow User Scripts is disabled');
    }),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const health = await getUserScriptsHealth(true);
  expect(health.state).toBe('disabled');
  expect(health.message).toMatch(/Allow User Scripts/i);
});

test('getUserScriptsHealth reports ok when probe registration succeeds', async () => {
  chrome.userScripts = {
    register: jest.fn(async () => {}),
    unregister: jest.fn(async () => {}),
  };
  browser.userScripts = chrome.userScripts;
  const health = await getUserScriptsHealth(true);
  expect(health.state).toBe('ok');
  expect(health.message).toBe('');
});

test('ensureMainWorldBridgeRegistration registers MV3 MAIN-world bridge content script', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    const registerContentScripts = jest.fn(async () => {});
    chrome.scripting = {
      registerContentScripts,
      unregisterContentScripts: jest.fn(async () => {}),
      getRegisteredContentScripts: jest.fn(async () => []),
    };
    const ok = await ensureMainWorldBridgeRegistration(true);
    expect(ok).toBe(true);
    expect(registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({
      id: 'vm-main-bridge',
      js: ['injected-web.js'],
      matches: ['*://*/*', 'file:///*'],
      runAt: 'document_end',
      allFrames: true,
      world: 'MAIN',
      persistAcrossSessions: true,
    })]);
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('ensureMainWorldBridgeRegistration skips re-registration when current config matches', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    chrome.scripting = {
      registerContentScripts: jest.fn(async () => {}),
      unregisterContentScripts: jest.fn(async () => {}),
      getRegisteredContentScripts: jest.fn(async () => [{
        id: 'vm-main-bridge',
        js: ['injected-web.js'],
        matches: ['*://*/*', 'file:///*'],
        runAt: 'document_end',
        allFrames: true,
        world: 'MAIN',
      }]),
    };
    const ok = await ensureMainWorldBridgeRegistration();
    expect(ok).toBe(true);
    expect(chrome.scripting.unregisterContentScripts).not.toHaveBeenCalled();
    expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('ensureMainWorldBridgeRegistration updates stale registration when config drifts', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    chrome.scripting = {
      registerContentScripts: jest.fn(async () => {}),
      unregisterContentScripts: jest.fn(async () => {}),
      getRegisteredContentScripts: jest.fn(async () => [{
        id: 'vm-main-bridge',
        js: ['injected-web.js'],
        matches: ['http://*/*', 'https://*/*'],
        runAt: 'document_idle',
        allFrames: true,
        world: 'ISOLATED',
      }]),
    };
    const ok = await ensureMainWorldBridgeRegistration();
    expect(ok).toBe(true);
    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['vm-main-bridge'],
    });
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('ensureMainWorldBridgeRegistration recovers from duplicate registration errors', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    const registerContentScripts = jest.fn()
      .mockRejectedValueOnce(new Error('Script id already exists'))
      .mockResolvedValueOnce();
    const unregisterContentScripts = jest.fn(async () => {});
    chrome.scripting = {
      registerContentScripts,
      unregisterContentScripts,
      getRegisteredContentScripts: jest.fn(async () => []),
    };
    const ok = await ensureMainWorldBridgeRegistration();
    expect(ok).toBe(true);
    expect(unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['vm-main-bridge'],
    });
    expect(registerContentScripts).toHaveBeenCalledTimes(2);
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('MainBridgePing reports ready when MAIN-world init hook exists', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    let details;
    chrome.scripting = {
      executeScript: jest.fn((injectedDetails, cb) => {
        details = injectedDetails;
        cb([{ result: { ready: true, url: 'https://www.torn.com/' } }]);
      }),
    };
    const res = await commands.MainBridgePing(null, {
      tab: { id: 77 },
      [kFrameId]: 0,
    });
    expect(details).toEqual(expect.objectContaining({
      target: { tabId: 77, frameIds: [0] },
      world: 'MAIN',
      func: expect.any(Function),
      args: [MAIN_BRIDGE_INIT_FUNC_NAME],
    }));
    expect(res).toEqual({
      state: 'ready',
      url: 'https://www.torn.com/',
    });
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('MainBridgePing reports execution errors', async () => {
  const oldManifestVersion = global.extensionManifest.manifest_version;
  global.extensionManifest.manifest_version = 3;
  try {
    tabs.executeScript = undefined;
    browser.scripting = undefined;
    chrome.scripting = {
      executeScript: jest.fn((details, cb) => {
        chrome.runtime.lastError = { message: 'main world blocked' };
        cb();
        chrome.runtime.lastError = null;
      }),
    };
    const res = await commands.MainBridgePing(null, {
      tab: { id: 78 },
      [kFrameId]: 0,
    });
    expect(res.state).toBe('error');
    expect(res.message).toMatch(/main world blocked/i);
  } finally {
    global.extensionManifest.manifest_version = oldManifestVersion;
  }
});

test('getTabUrl prefers current tab.url over pendingUrl', () => {
  const { getTabUrl } = require('@/background/utils/tabs');
  expect(getTabUrl({
    url: 'https://www.torn.com/forums.php#/!p=threads&f=61&t=16047184',
    pendingUrl: 'chrome://startpageshared/',
  })).toBe('https://www.torn.com/forums.php#/!p=threads&f=61&t=16047184');
});

test('getTabUrl falls back to pendingUrl when url is absent', () => {
  const { getTabUrl } = require('@/background/utils/tabs');
  expect(getTabUrl({
    pendingUrl: 'https://example.com/pending',
  })).toBe('https://example.com/pending');
});
