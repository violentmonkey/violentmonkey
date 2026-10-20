let originalWindows;
let originalPermissions;
let platformInfo;
let browserInfo;
let userAgent;
let platform;
let touchPoints;

beforeEach(() => {
  originalWindows = browser.windows;
  originalPermissions = browser.permissions;
  platformInfo = browser.runtime.getPlatformInfo;
  browserInfo = browser.runtime.getBrowserInfo;
  userAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  platform = Object.getOwnPropertyDescriptor(navigator, 'platform');
  touchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
});

afterEach(() => {
  browser.windows = originalWindows;
  browser.permissions = originalPermissions;
  browser.runtime.getPlatformInfo = platformInfo;
  if (browserInfo) browser.runtime.getBrowserInfo = browserInfo;
  else delete browser.runtime.getBrowserInfo;
  for (const [key, descriptor] of [
    ['userAgent', userAgent], ['platform', platform], ['maxTouchPoints', touchPoints],
  ]) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else delete navigator[key];
  }
});

function load(module) {
  let state;
  let api;
  jest.isolateModules(() => {
    state = require('@/background/utils/init');
    state.init.catch(() => {});
    api = module === 'ua'
      ? require('@/background/utils/ua')
      : require('@/background/utils/permissions');
  });
  return { ...state, api };
}

test('initializes without optional platform and windows APIs', async () => {
  browser.runtime.getPlatformInfo = undefined;
  browser.windows = undefined;
  const state = load('ua');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
  expect(state.api.ua.browserName).toBe('chrome');
});

test('initializes when optional platform discovery rejects or throws', async () => {
  browser.runtime.getPlatformInfo = async () => { throw new Error('Not implemented'); };
  browser.runtime.getBrowserInfo = async () => { throw new Error('Not implemented'); };
  browser.windows = { getAll: async () => { throw new Error('Not implemented'); } };
  const state = load('ua');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
});

test('initializes when an optional platform method throws synchronously', async () => {
  browser.runtime.getPlatformInfo = () => { throw new Error('Not implemented'); };
  const state = load('ua');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
});

test('initializes when optional platform methods return null', async () => {
  browser.runtime.getPlatformInfo = async () => null;
  browser.runtime.getBrowserInfo = async () => null;
  browser.windows = { getAll: async () => null };
  const state = load('ua');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
});

test('retains reported browser information without a window event API', async () => {
  browser.runtime.getPlatformInfo = async () => ({ os: 'ios', arch: 'arm' });
  browser.runtime.getBrowserInfo = async () => ({ name: 'Orion', version: '1.4.19' });
  browser.windows = { getAll: async () => [] };
  const state = load('ua');
  const ready = state.init;
  await state.resolveInit();
  await ready;
  expect(state.api.ua).toMatchObject({
    os: 'ios', arch: 'arm', browserName: 'Orion', browserVersion: '1.4.19',
  });
});

test('initializes when an optional window listener throws synchronously', async () => {
  browser.windows = {
    getAll: async () => [],
    onCreated: { addListener: () => { throw new Error('Not implemented'); } },
  };
  const state = load('ua');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
});

test('recognizes iPad desktop user agents as mobile hardware', async () => {
  Object.defineProperties(navigator, {
    userAgent: { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' },
    platform: { configurable: true, value: 'MacIntel' },
    maxTouchPoints: { configurable: true, value: 5 },
  });
  const state = load('ua');
  await state.resolveInit();
  expect(state.api.ua.mobile).toBe(true);
});

test.each(['missing', 'rejecting'])('continues without %s optional permission queries', async kind => {
  browser.permissions = kind === 'missing' ? undefined : {
    contains: async () => { throw new Error('Not implemented'); },
  };
  const state = load('permissions');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
  expect(state.api.permissionDownloads).toBe(false);
});

test('initializes when optional permission listeners throw synchronously', async () => {
  const unsupported = () => { throw new Error('Not implemented'); };
  browser.permissions = {
    contains: async () => false,
    onAdded: { addListener: unsupported },
    onRemoved: { removeListener: unsupported },
  };
  const state = load('permissions');
  const ready = state.init;
  await state.resolveInit();
  await expect(ready).resolves.toBeUndefined();
  expect(state.api.permissionDownloads).toBe(false);
});
