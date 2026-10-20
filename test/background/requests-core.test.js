jest.mock('@/background/utils/ua', () => ({ CHROME: 120 }));

let previousWebRequest;
let previousCookies;

beforeEach(() => {
  previousWebRequest = browser.webRequest;
  previousCookies = browser.cookies;
});

afterEach(() => {
  browser.webRequest = previousWebRequest;
  browser.cookies = previousCookies;
});

function loadCore(api) {
  browser.webRequest = api;
  let core;
  jest.isolateModules(() => { core = require('@/background/utils/requests-core'); });
  return core;
}

function makeEvents() {
  const listeners = {};
  const api = {};
  ['onBeforeSendHeaders', 'onHeadersReceived'].forEach(name => {
    api[name] = {
      addListener: fn => { listeners[name] = fn; },
      removeListener: () => { delete listeners[name]; },
    };
  });
  return { api, listeners };
}

test('loads and releases ordinary requests when webRequest is unavailable', () => {
  const core = loadCore(undefined);
  expect(() => core.toggleHeaderInjector('request', {})).not.toThrow();
  expect(() => core.toggleHeaderInjector('request', false)).not.toThrow();
});

test('uses webRequest listeners when optional header enums are unavailable', () => {
  const { api, listeners } = makeEvents();
  const core = loadCore(api);
  core.requests.request = { cookie: true };
  core.toggleHeaderInjector('request', { referer: { name: 'Referer', value: 'https://example.org/' } });
  const result = listeners.onBeforeSendHeaders({
    requestId: 'native', tabId: -1, url: 'https://example.com/#request', requestHeaders: [],
  });
  expect(result.requestHeaders).toEqual([{ name: 'Referer', value: 'https://example.org/' }]);
  core.toggleHeaderInjector('request', false);
  expect(Object.keys(listeners)).toHaveLength(0);
});

test('replaces same-named cookies while preserving the browser cookie set', () => {
  const { api, listeners } = makeEvents();
  api.OnBeforeSendHeadersOptions = {};
  const core = loadCore(api);
  core.requests.request = { cookie: true };
  core.toggleHeaderInjector('request', { cookie: { name: 'Cookie', value: 'session=new; extra=1' } });
  const result = listeners.onBeforeSendHeaders({
    requestId: 'native', tabId: -1, url: 'https://example.com/#request',
    requestHeaders: [{ name: 'Cookie', value: 'session=old; other=2; session=second' }],
  });
  expect(result.requestHeaders).toEqual([{ name: 'cookie', value: 'other=2; session=new; extra=1' }]);
});

test('routes partitioned response cookies to the selected partition', () => {
  const { api, listeners } = makeEvents();
  api.OnBeforeSendHeadersOptions = {};
  browser.cookies = { set: jest.fn(async () => {}) };
  const core = loadCore(api);
  core.requests.request = {
    'set-cookie': true,
    cookiePartition: { topLevelSite: 'https://example.org' },
  };
  core.verify.native = 'request';
  core.toggleHeaderInjector('request', {});
  const response = listeners.onHeadersReceived({
    requestId: 'native', tabId: -1, url: 'https://example.com/',
    responseHeaders: [{ name: 'Set-Cookie', value: 'session=next; Secure; Partitioned; Path=/' }],
  });
  expect(response.responseHeaders).toEqual([]);
  expect(browser.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
    url: 'https://example.com/',
    name: 'session',
    value: 'next',
    partitionKey: { topLevelSite: 'https://example.org' },
  }));
});

test.each([
  ['Max-Age=3600; Expires=Wed, 21 Oct 2026 07:28:00 GMT;', 2_000_003_600],
  ['Expires=Wed, 21 Oct 2026 07:28:00 GMT;', 1_792_567_680],
])('preserves partition and expiration after %s', (expiration, expected) => {
  const { api, listeners } = makeEvents();
  api.OnBeforeSendHeadersOptions = {};
  browser.cookies = { set: jest.fn(async () => {}) };
  const clock = jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
  try {
    const core = loadCore(api);
    core.requests.request = {
      'set-cookie': true,
      cookiePartition: { topLevelSite: 'https://example.org' },
    };
    core.verify.native = 'request';
    core.toggleHeaderInjector('request', {});
    listeners.onHeadersReceived({
      requestId: 'native', tabId: -1, url: 'https://example.com/',
      responseHeaders: [{
 name: 'Set-Cookie',
        value: `session=next; ${expiration} Secure; SameSite=None; Partitioned; Path=/`
}],
    });
    expect(browser.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: 'session',
      value: 'next',
      expirationDate: expected,
      secure: true,
      sameSite: 'no_restriction',
      path: '/',
      partitionKey: { topLevelSite: 'https://example.org' },
    }));
  } finally {
    clock.mockRestore();
  }
});

test.each(['__Host-session', '__Secure-session'])('preserves the name of routed %s cookies', name => {
  const { api, listeners } = makeEvents();
  api.OnBeforeSendHeadersOptions = {};
  browser.cookies = { set: jest.fn(async () => {}) };
  const core = loadCore(api);
  core.requests.request = {
    'set-cookie': true,
    cookiePartition: { topLevelSite: 'https://example.org' },
  };
  core.verify.native = 'request';
  core.toggleHeaderInjector('request', {});
  listeners.onHeadersReceived({
    requestId: 'native', tabId: -1, url: 'https://example.com/',
    responseHeaders: [{ name: 'Set-Cookie', value: `${name}=next; Secure; Partitioned; Path=/` }],
  });
  expect(browser.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
    name,
    value: 'next',
    secure: true,
    partitionKey: { topLevelSite: 'https://example.org' },
  }));
});
