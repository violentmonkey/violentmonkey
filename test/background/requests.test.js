import { createServer } from 'node:http';
import { runInThisContext } from 'node:vm';

jest.mock('@/background/utils/init', () => {
  const cmds = {};
  return {
    commands: cmds,
    addOwnCommands: jest.fn(),
    addPublicCommands: obj => Object.assign(cmds, obj),
  };
});
jest.mock('@/background/utils/requests-core', () => ({
  FORBIDDEN_HEADER_RE: /^(cookie|origin|referer)$/i,
  kCookie: 'cookie',
  kSetCookie: 'set-cookie',
  kRequestHeaders: 'requestHeaders',
  requests: {},
  verify: {},
  toggleHeaderInjector: jest.fn(() => true),
}));
jest.mock('@/background/utils/dnr', () => ({
  DNR: { updateSessionRules: jest.fn(async () => {}) },
  DNR_ID_XHR: 10,
  updateSessionRules: jest.fn(),
  xhrRules: {},
}));
jest.mock('@/background/utils/download-via-api', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/background/utils/offscreen', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/background/utils/options', () => ({ getOption: () => false }));
jest.mock('@/background/utils/permissions', () => ({ permissionDownloads: false }));
jest.mock('@/background/utils/session-data', () => ({ badges: {} }));
jest.mock('@/background/utils/tabs', () => ({
  getFrameDocIdFromSrc: src => src.frameId,
  getFrameDocIdAsObj: frameId => ({ frameId }),
}));
jest.mock('@/background/utils/ua', () => ({
  FIREFOX: 0,
  ua: {},
  navUA: 'test',
  navUAD: {},
}));
jest.mock('@/background/utils/url', () => ({ vetUrl: url => url }));
jest.mock('@/common', () => ({
  ...jest.requireActual('@/common'),
  sendTabCmd: jest.fn(),
}));

const { fetch, Headers, Response, AbortController } = runInThisContext(
  '({ fetch, Headers, Response, AbortController })',
);
let commands;
let sendTabCmd;
let requests;
let server;
let base;
let finishStream;
let listener;
let toggleHeaderInjector;
let previousCookies;
let visited;

beforeAll(async () => {
  Object.assign(global, { fetch, Headers, Response, AbortController });
  ({ commands } = require('@/background/utils/init'));
  ({ sendTabCmd } = require('@/common'));
  ({ requests } = require('@/background/utils/requests-core'));
  ({ toggleHeaderInjector } = require('@/background/utils/requests-core'));
  previousCookies = browser.cookies;
  require('@/background/utils/requests');
  server = createServer((req, res) => {
    if (req.method !== 'OPTIONS') visited.push(req.url);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.writeHead(204).end();
    } else if (req.url.startsWith('/redirect')) {
      res.writeHead(302, { Location: '/final' }).end();
    } else if (req.url.startsWith('/stream')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.write(Buffer.from([0, 128, 255]));
      finishStream = () => res.end(Buffer.from([10, 20]));
    } else if (req.url.startsWith('/slow')) {
      res.writeHead(200).flushHeaders();
      finishStream = () => res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: req.url, headers: req.headers }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  browser.cookies = previousCookies;
  finishStream?.();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  visited = [];
  __.MV3 = false;
  browser.cookies = previousCookies;
  toggleHeaderInjector.mockReset().mockReturnValue(true);
  listener = () => {};
  sendTabCmd.mockImplementation((tabId, cmd, msg) => {
    listener(msg);
    return Promise.resolve();
  });
});

function startRequest(path, extra = {}, tabDetails = {}) {
  const messages = [];
  const pending = {};
  const next = type => new Promise(resolve => { pending[type] = resolve; });
  listener = msg => {
    messages.push(msg);
    pending[msg.type]?.(msg);
    delete pending[msg.type];
  };
  const id = `request${Math.random()}`;
  const done = next('loadend');
  const task = commands.HttpRequest({
    id,
    scriptId: 1,
    url: base + path,
    data: [],
    ua: ['test'],
    responseType: '',
    xhrType: '',
    events: [{
 load: true, error: true, abort: true, timeout: true, loadstart: true,
      progress: true, readystatechange: true
}, {}],
    ...extra,
  }, { tab: { id: 5, ...tabDetails }, frameId: 0, url: base });
  return { id, messages, next, done, task };
}

test('streams byte chunks before the response finishes and cleans up the request', async () => {
  const req = startRequest('/stream', { responseType: 'stream' });
  const start = await req.next('loadstart');
  try {
    expect(start).toMatchObject({ stream: true, data: { status: 200 } });
  } finally {
    if (!start.stream) commands.AbortRequest(req.id);
    else finishStream();
  }
  await req.done;
  await req.task;
  const chunks = req.messages.filter(msg => msg.stream && msg.type === 'progress')
    .map(msg => Buffer.from(msg.data.response, 'base64'));
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 128, 255, 10, 20]));
  expect(req.messages.filter(msg => msg.type === 'load')).toHaveLength(1);
  expect(requests[req.id]).toBeUndefined();
});

test('fetch mode follows redirects and decodes the response', async () => {
  const req = startRequest('/redirect', { fetch: true, redirect: 'follow' });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toContain('load');
  const data = req.messages.find(msg => msg.type === 'load').data;
  expect(data.finalUrl).toBe(base + '/final');
  const text = req.messages.map(msg => msg.data?.response || '').join('');
  expect(JSON.parse(text).path).toBe('/final');
});

test('redirect error mode fails without loading the target', async () => {
  const req = startRequest('/redirect', { redirect: 'error' });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toContain('error');
  expect(req.messages.map(msg => msg.type)).not.toContain('load');
});

test('redirect manual mode preserves the redirect response instead of following', async () => {
  const req = startRequest('/redirect', { redirect: 'manual' });
  await req.done;
  await req.task;
  const data = req.messages.find(msg => msg.type === 'load').data;
  expect(data.status).toBe(302);
  expect(data.finalUrl).toBe(base + '/redirect');
});

test('aborts a fetch stream and sends exactly one terminal event', async () => {
  const req = startRequest('/slow', { responseType: 'stream', fetch: true });
  await req.next('loadstart');
  commands.AbortRequest(req.id);
  await req.done;
  finishStream?.();
  await req.task;
  expect(req.messages.map(msg => msg.type).filter(type =>
    ['abort', 'load', 'error', 'timeout'].includes(type))).toEqual(['abort']);
  expect(requests[req.id]).toBeUndefined();
});

test('times out an unfinished fetch stream and cleans it up', async () => {
  const req = startRequest('/slow', { responseType: 'stream', timeout: 30 });
  await req.next('loadstart');
  await req.done;
  finishStream();
  await req.task;
  expect(req.messages.map(msg => msg.type).filter(type =>
    ['abort', 'load', 'error', 'timeout'].includes(type))).toEqual(['timeout']);
  expect(requests[req.id]).toBeUndefined();
});

test('merges the cookie option into explicitly supplied cookies', async () => {
  const req = startRequest('/final', {
    fetch: true,
    headers: { Cookie: 'legacy=old; session=old' },
    cookie: 'session=new; extra=yes',
  });
  await req.done;
  await req.task;
  expect(toggleHeaderInjector).toHaveBeenCalledWith(req.id, {
    cookie: { name: 'cookie', value: 'legacy=old; session=new; extra=yes' },
  });
});

test('selects partitioned cookies while preserving unpartitioned cookies', async () => {
  browser.cookies = {
    getAllCookieStores: async () => [{ id: '0', tabIds: [5] }],
    set: async () => {},
    getAll: jest.fn(async query => query.partitionKey
      ? [{ name: 'part', value: 'two', session: true }]
      : [{ name: 'regular', value: 'one', session: true }]),
  };
  const req = startRequest('/final', {
    fetch: true,
    cookiePartition: { topLevelSite: 'https://example.org' },
  });
  await req.done;
  await req.task;
  expect(browser.cookies.getAll).toHaveBeenCalledWith(expect.objectContaining({
    partitionKey: { topLevelSite: 'https://example.org' },
  }));
  expect(toggleHeaderInjector).toHaveBeenCalledWith(req.id, {
    cookie: { name: 'cookie', value: 'regular=one; part=two' },
  });
});

test('reports an unsupported cookie partition instead of dropping it and releases the request', async () => {
  browser.cookies = undefined;
  const req = startRequest('/final', { fetch: true, cookiePartition: { topLevelSite: base } });
  try {
    await req.task;
    expect(req.messages.map(msg => msg.type)).toEqual(['error', 'loadend']);
    expect(requests[req.id]).toBeUndefined();
  } finally {
    commands.AbortRequest(req.id);
  }
});

test.each([false, true])('sets fetch credentials for anonymous=%s', async anonymous => {
  const calls = [];
  global.fetch = (url, init) => { calls.push(init); return fetch(url, init); };
  const req = startRequest('/final', { fetch: true, anonymous });
  await req.done;
  await req.task;
  global.fetch = fetch;
  expect(calls[0].credentials).toBe(anonymous ? 'omit' : 'include');
});

test.each([
  [{ nocache: true }, 'no-store'],
  [{ revalidate: true }, 'no-cache'],
])('honors cache options without an explicit fetch flag: %j', async (options, cache) => {
  const calls = [];
  global.fetch = (url, init) => { calls.push(init); return fetch(url, init); };
  const req = startRequest('/final', options);
  await req.done;
  await req.task;
  global.fetch = fetch;
  expect(calls.map(init => init.cache)).toEqual([cache]);
});

test('rejects a partition when response cookies cannot be written', async () => {
  browser.cookies = { getAll: async () => [] };
  const req = startRequest('/final', { fetch: true, cookiePartition: { topLevelSite: base } });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toEqual(['error', 'loadend']);
  expect(requests[req.id]).toBeUndefined();
});

test('rejects an MV3 cookie partition when response headers cannot be observed', async () => {
  __.MV3 = true;
  browser.cookies = { getAll: async () => [], set: async () => {} };
  toggleHeaderInjector.mockReturnValue(false);
  const req = startRequest('/final', { fetch: true, cookiePartition: { topLevelSite: base } });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toEqual(['error', 'loadend']);
  expect(requests[req.id]).toBeUndefined();
  __.MV3 = false;
});

test.each([
  { cookie: 'session=custom' },
  { headers: { Cookie: 'session=custom' } },
  { cookiePartition: { topLevelSite: 'https://example.org' } },
])('blocks redirects by default for a selected cookie context: %j', async options => {
  browser.cookies = { getAll: async () => [], set: async () => {} };
  const req = startRequest('/redirect', options);
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toContain('error');
  expect(req.messages.map(msg => msg.type)).not.toContain('load');
  expect(visited).toEqual(['/redirect']);
});

test('rejects explicit redirect following with custom cookies before contacting the server', async () => {
  const req = startRequest('/redirect', { fetch: true, cookie: 'session=custom', redirect: 'follow' });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toEqual(['error', 'loadend']);
  expect(visited).toEqual([]);
});

test('supports manual redirect responses with custom cookies', async () => {
  const req = startRequest('/redirect', { cookie: 'session=custom', redirect: 'manual' });
  await req.done;
  await req.task;
  expect(req.messages.find(msg => msg.type === 'load').data.status).toBe(302);
  expect(visited).toEqual(['/redirect']);
});

test('blocks redirects from a non-default cookie store', async () => {
  browser.cookies = {
    getAllCookieStores: async () => [{ id: '1', tabIds: [5] }],
    getAll: async () => [{ name: 'private', value: 'one', session: true }],
    set: async () => {},
  };
  const req = startRequest('/redirect', {}, { incognito: true });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toContain('error');
  expect(visited).toEqual(['/redirect']);
});

test('rejects unidentified incognito cookie stores instead of reading the default profile', async () => {
  browser.cookies = {
    getAllCookieStores: async () => [],
    getAll: jest.fn(async () => []),
    set: async () => {},
  };
  const req = startRequest('/final', {}, { incognito: true });
  await req.done;
  await req.task;
  expect(req.messages.map(msg => msg.type)).toEqual(['error', 'loadend']);
  expect(browser.cookies.getAll).not.toHaveBeenCalled();
  expect(visited).toEqual([]);
});

test('uses worker fetch for MV3 streams and releases the header rule', async () => {
  __.MV3 = true;
  const { DNR, updateSessionRules } = require('@/background/utils/dnr');
  const req = startRequest('/stream', { responseType: 'stream', anonymous: true });
  const start = await req.next('loadstart');
  finishStream();
  await req.done;
  await req.task;
  expect(start.stream).toBe(true);
  expect(DNR.updateSessionRules).toHaveBeenCalledWith(expect.objectContaining({
    addRules: [expect.objectContaining({
      action: expect.objectContaining({
        requestHeaders: expect.arrayContaining([{ header: 'cookie', operation: 'remove' }]),
      }),
    })],
  }));
  expect(updateSessionRules).toHaveBeenCalledWith([expect.any(Number)]);
  expect(requests[req.id]).toBeUndefined();
  __.MV3 = false;
});

test.each([
  [false, 'progress', false],
  [true, 'progress', false],
  [false, 'loadend', false],
  [true, 'loadend', false],
  [false, 'progress', true],
  [true, 'progress', true],
])('cleans up XHR after tab delivery failure (MV3=%s, event=%s, sync=%s)', async (mv3, failedEvent, sync) => {
  __.MV3 = mv3;
  const common = require('@/common');
  const keepAlive = common.keepAlive;
  const keeper = mv3 && jest.spyOn(common, 'keepAlive').mockImplementation(() => jest.fn(keepAlive()));
  const deliver = sendTabCmd.getMockImplementation();
  sendTabCmd.mockImplementation((...args) => {
    const result = deliver(...args);
    if (args[2].type === failedEvent) {
      const err = new Error('The tab was closed.');
      if (sync) throw err;
      return Promise.reject(err);
    }
    return result;
  });
  const req = startRequest('/stream');
  try {
    await req.task;
    let xhrMap;
    if (mv3) {
      const offscreen = require('@/background/utils/offscreen').default;
      const [, opts] = offscreen.mock.calls.find(([cmd, value]) =>
        cmd === 'XHRStart' && value.cb[0].id === req.id);
      jest.isolateModules(() => {
        const { initXHR, xhrs } = require('@/offscreen/xhr');
        xhrMap = xhrs;
        initXHR(opts, req.id);
      });
    }
    const active = requests[req.id];
    const nativeEnd = new Promise(resolve => active.xhr.addEventListener('loadend', resolve));
    const core = require('@/background/utils/requests-core');
    active.coreId = 'native-delivery-test';
    core.verify[active.coreId] = req.id;
    const release = active.resolve;
    await req.next('progress');
    finishStream();
    await nativeEnd;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requests[req.id]).toBeUndefined();
    expect(core.verify['native-delivery-test']).toBeUndefined();
    expect(toggleHeaderInjector).toHaveBeenLastCalledWith(req.id, false);
    if (mv3) {
      const { xhrRules, updateSessionRules } = require('@/background/utils/dnr');
      expect(xhrRules[active.ruleId]).toBeUndefined();
      expect(updateSessionRules).toHaveBeenCalledWith([active.ruleId]);
      expect(release).toHaveBeenCalledTimes(1);
      expect(xhrMap.has(req.id)).toBe(false);
    }
  } finally {
    if (requests[req.id]) {
      await requests[req.id].cb({ id: req.id, type: 'loadend', data: null }).catch(() => {});
    }
    if (keeper) keeper.mockRestore();
    __.MV3 = false;
  }
});
