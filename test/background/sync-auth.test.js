jest.mock('@/background/utils/dnr', () => ({
  DNR_ID_IDENTITY: 99,
  updateSessionRules: jest.fn(async () => {}),
}));
// Not used by the auth flow; they would otherwise need a full extension environment
jest.mock('@/background/utils/db', () => ({}));
jest.mock('@/background/plugin', () => ({}));
jest.mock('@usync/sync', () => ({}), { virtual: true });
jest.mock('@usync/oauth2', () => ({}), { virtual: true });
jest.mock('@usync/drive', () => ({}), { virtual: true });

const { updateSessionRules } = require('@/background/utils/dnr');
const { openAuthPageMV3, openAuthTabMV3 } = require('@/background/sync/sync-engine');

const AUTH_URL = 'https://accounts.example.com/auth';
const REDIRECT_URI = 'http://127.0.0.1:45678/';
const TAB_ID = 7;

function mockEvent() {
  const listeners = new Set();
  return {
    addListener: jest.fn((fn) => listeners.add(fn)),
    removeListener: jest.fn((fn) => listeners.delete(fn)),
    fire: (...args) => listeners.forEach((fn) => fn(...args)),
    get size() { return listeners.size; },
  };
}

let identity, tabs, webRequest;

beforeEach(() => {
  updateSessionRules.mockClear();
  identity = { launchWebAuthFlow: jest.fn(), getRedirectURL: () => 'https://id.chromiumapp.org/' };
  webRequest = { onBeforeRequest: mockEvent(), onBeforeRedirect: mockEvent() };
  tabs = {
    onRemoved: mockEvent(),
    create: jest.fn(async () => ({ id: TAB_ID })),
    // Navigating the tab is when the auth page would start redirecting
    update: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  };
  Object.assign(global.chrome, { identity, tabs, webRequest });
});

/** Waits until the auth tab is navigating, i.e. the listeners are in place. */
const untilNavigating = () => new Promise((resolve) => {
  tabs.update.mockImplementation(async () => { setTimeout(resolve); });
});

test('uses launchWebAuthFlow when it works', async () => {
  identity.launchWebAuthFlow.mockResolvedValue('https://id.chromiumapp.org/?code=1');
  await expect(openAuthPageMV3(AUTH_URL, REDIRECT_URI)).resolves.toBe('https://id.chromiumapp.org/?code=1');
  expect(tabs.create).not.toHaveBeenCalled();
});

test('rethrows unrelated launchWebAuthFlow errors, e.g. a cancelled sign-in', async () => {
  identity.launchWebAuthFlow.mockRejectedValue(new Error('The user did not approve access.'));
  await expect(openAuthPageMV3(AUTH_URL, REDIRECT_URI)).rejects.toThrow('did not approve');
  expect(tabs.create).not.toHaveBeenCalled();
});

test.each([
  "Couldn't create a browser window to display an authorization page.",
  'identity.launchWebAuthFlow not implemented',
])('falls back to a tab when launchWebAuthFlow fails with "%s"', async (message) => {
  identity.launchWebAuthFlow.mockRejectedValue(new Error(message));
  const navigating = untilNavigating();
  const result = openAuthPageMV3(AUTH_URL, REDIRECT_URI);
  await navigating;
  webRequest.onBeforeRedirect.fire({ redirectUrl: `${REDIRECT_URI}?code=abc` });
  await expect(result).resolves.toBe(`${REDIRECT_URI}?code=abc`);
  expect(tabs.update).toHaveBeenCalledWith(TAB_ID, { url: AUTH_URL });
});

describe('openAuthTabMV3', () => {
  test('captures a server redirect to the redirect URI and cleans up', async () => {
    const navigating = untilNavigating();
    const result = openAuthTabMV3(AUTH_URL, REDIRECT_URI);
    await navigating;
    webRequest.onBeforeRedirect.fire({ redirectUrl: 'https://accounts.example.com/consent' });
    webRequest.onBeforeRedirect.fire({ redirectUrl: `${REDIRECT_URI}?code=abc` });
    await expect(result).resolves.toBe(`${REDIRECT_URI}?code=abc`);
    expect(webRequest.onBeforeRequest.size).toBe(0);
    expect(webRequest.onBeforeRedirect.size).toBe(0);
    expect(tabs.onRemoved.size).toBe(0);
    expect(tabs.remove).toHaveBeenCalledWith(TAB_ID);
    expect(updateSessionRules).toHaveBeenLastCalledWith([99]);
  });

  test('blocks the redirect URI in the auth tab only', async () => {
    const navigating = untilNavigating();
    const result = openAuthTabMV3(AUTH_URL, REDIRECT_URI);
    await navigating;
    expect(updateSessionRules).toHaveBeenCalledWith(
      99,
      { urlFilter: `|${REDIRECT_URI}`, resourceTypes: ['main_frame'], tabIds: [TAB_ID] },
      { type: 'block' },
    );
    expect(webRequest.onBeforeRequest.addListener).toHaveBeenCalledWith(
      expect.any(Function),
      { urls: ['<all_urls>'], tabId: TAB_ID, types: ['main_frame'] },
    );
    webRequest.onBeforeRequest.fire({ url: `${REDIRECT_URI}?code=abc` });
    await expect(result).resolves.toBe(`${REDIRECT_URI}?code=abc`);
  });

  test('resolves null when the user closes the auth tab', async () => {
    const navigating = untilNavigating();
    const result = openAuthTabMV3(AUTH_URL, REDIRECT_URI);
    await navigating;
    tabs.onRemoved.fire(TAB_ID + 1);
    tabs.onRemoved.fire(TAB_ID);
    await expect(result).resolves.toBeNull();
  });
});
