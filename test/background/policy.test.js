import { parseMeta } from '@/background/utils/script';

const URL_A = 'https://example.com/a.user.js';
const URL_B = 'https://example.com/b.user.js';
const URL_C = 'https://example.com/c.user.js';
const codeFor = name => `// ==UserScript==
// @name ${name}
// @namespace policy-test
// @match https://example.com/*
// @grant none
// ==/UserScript==
`;
const flush = () => new Promise(resolve => setTimeout(resolve));

let scripts;
let policy;
let init;
let managed;
let onChanged;
let request;
let parseScript;
let resolveInit;

beforeEach(() => {
  jest.resetModules();
  scripts = [];
  policy = { scripts: [URL_A] };
  init = {
    init: new Promise(resolve => { resolveInit = resolve; }),
    inIncognitoContext: false,
  };
  onChanged = { addListener: jest.fn() };
  managed = { get: jest.fn(async () => policy), onChanged };
  browser.storage.managed = managed;
  request = jest.fn(async url => ({ data: codeFor(url) }));
  parseScript = jest.fn(async ({ code, url }) => {
    scripts.push({ meta: parseMeta(code), custom: { lastInstallURL: url }, config: {} });
  });
  jest.doMock('@/common/browser', () => ({ __esModule: true, default: browser }));
  jest.doMock('@/background/utils/init', () => init);
  jest.doMock('@/background/utils/script', () => ({ parseMeta }));
  jest.doMock('@/background/utils/url', () => ({ request }));
  jest.doMock('@/background/utils/db', () => ({
    getScriptsByIdsOrAll: () => scripts,
    getScript: ({ meta, removed }) => scripts.find(script => (
      !!script.config.removed === !!removed
      && script.meta.name === meta.name
      && script.meta.namespace === meta.namespace
    )),
    parseScript,
  }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete browser.storage.managed;
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete __.MV3;
  global.IS_FIREFOX = false;
});

function loadPolicy() {
  require('@/background/utils/policy');
  return () => onChanged.addListener.mock.calls[0]?.[0]({ scripts: {} });
}

async function apply() {
  const refresh = loadPolicy();
  resolveInit();
  await refresh();
  await flush();
  return refresh;
}

test('registers changes immediately and installs automatically after database initialization', async () => {
  loadPolicy();
  expect(onChanged.addListener).toHaveBeenCalledTimes(1);
  await flush();
  expect(managed.get).not.toHaveBeenCalled();
  expect(parseScript).not.toHaveBeenCalled();
  resolveInit();
  await flush();
  expect(managed.get).toHaveBeenCalledWith('scripts');
  expect(parseScript).toHaveBeenCalledWith({
    code: codeFor(URL_A), url: URL_A, isNew: true, bumpDate: true,
  });
});

test('installs unique URLs only once across repeated policy applications', async () => {
  policy.scripts = [URL_A, URL_A, URL_B];
  const refresh = await apply();
  await refresh();
  expect(request).toHaveBeenCalledTimes(2);
  expect(parseScript).toHaveBeenCalledTimes(2);
});

test('preserves scripts and recycle-bin entries from the same installation URL', async () => {
  policy.scripts = [URL_A, URL_B];
  scripts.push(
    { custom: { lastInstallURL: URL_A }, config: { enabled: 0, shouldUpdate: 0 } },
    { custom: { lastInstallURL: URL_B }, config: { removed: 1 } },
  );
  const before = JSON.stringify(scripts);
  await apply();
  expect(request).not.toHaveBeenCalled();
  expect(parseScript).not.toHaveBeenCalled();
  expect(JSON.stringify(scripts)).toBe(before);
});

test.each([0, 1])('preserves a matching name/namespace from another URL (removed=%s)', async removed => {
  scripts.push({ meta: parseMeta(codeFor(URL_A)), custom: {}, config: { removed } });
  await apply();
  expect(request).toHaveBeenCalledTimes(1);
  expect(parseScript).not.toHaveBeenCalled();
});

test('allows the same name in a different namespace', async () => {
  scripts.push({ meta: { name: URL_A, namespace: 'other' }, custom: {}, config: {} });
  await apply();
  expect(parseScript).toHaveBeenCalledTimes(1);
});

test('handles missing or unavailable managed storage', async () => {
  delete browser.storage.managed;
  await apply();
  expect(onChanged.addListener).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test('installs at startup in Firefox without registering a change listener', async () => {
  global.IS_FIREFOX = true;
  await apply();
  expect(onChanged.addListener).not.toHaveBeenCalled();
  expect(parseScript).toHaveBeenCalledTimes(1);
});

test('ignores an unconfigured Firefox policy', async () => {
  global.IS_FIREFOX = true;
  managed.get.mockRejectedValueOnce(new Error('Managed storage manifest not found'));
  await apply();
  expect(onChanged.addListener).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
});

test.each([{}, { scripts: [] }, { scripts: null }])('ignores an empty policy: %j', async value => {
  policy = value;
  await apply();
  expect(request).not.toHaveBeenCalled();
});

test.each(['https://example.com/a.user.js', {}, 1])('rejects a non-array policy: %j', async value => {
  policy.scripts = value;
  await apply();
  expect(request).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledTimes(1);
});

test('skips invalid entries and non-HTTP URLs while installing valid entries', async () => {
  policy.scripts = [null, {}, 1, '', 'not a URL', 'https://', 'file:///a.user.js',
    'data:text/javascript,alert(1)', 'javascript:alert(1)', URL_A];
  await apply();
  expect(request).toHaveBeenCalledTimes(1);
  expect(parseScript).toHaveBeenCalledTimes(1);
});

test.each(['<html>not a userscript</html>', '// ==UserScript==\n// ==/UserScript==', null])(
  'rejects invalid script source and continues: %j', async code => {
    policy.scripts = [URL_A, URL_B];
    request.mockResolvedValueOnce({ data: code });
    await apply();
    expect(parseScript).toHaveBeenCalledTimes(1);
    expect(parseScript.mock.calls[0][0].url).toBe(URL_B);
  },
);

test('continues after a failed download and retries it on the next policy application', async () => {
  policy.scripts = [URL_A, URL_B];
  request.mockRejectedValueOnce(new Error('Network error'));
  const refresh = await apply();
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_B]);
  await refresh();
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_B, URL_A]);
});

test('continues after an installation error', async () => {
  policy.scripts = [URL_A, URL_B];
  parseScript.mockRejectedValueOnce(new Error('Storage error'));
  await apply();
  expect(parseScript).toHaveBeenCalledTimes(2);
  expect(scripts.map(script => script.custom.lastInstallURL)).toEqual([URL_B]);
});

test('applies only managed script changes and leaves removed policy scripts installed', async () => {
  await apply();
  const [listener] = onChanged.addListener.mock.calls[0];
  const reads = managed.get.mock.calls.length;
  await listener({ other: { newValue: true } });
  expect(managed.get).toHaveBeenCalledTimes(reads);
  policy.scripts = [URL_B];
  await listener({ scripts: { newValue: [URL_B] } });
  policy = {};
  await listener({ scripts: { oldValue: [URL_B] } });
  expect(scripts.map(script => script.custom.lastInstallURL)).toEqual([URL_A, URL_B]);
});

test('discards a download if the policy changes before it finishes', async () => {
  let finish;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = loadPolicy();
  resolveInit();
  await flush();
  expect(request).toHaveBeenCalledTimes(1);
  policy.scripts = [URL_B];
  const next = refresh();
  finish({ data: codeFor(URL_A) });
  await next;
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_B]);
});

test('aborts all pending downloads when the policy changes', async () => {
  policy.scripts = [URL_A, URL_B];
  const pending = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')));
  });
  request.mockImplementationOnce(pending).mockImplementationOnce(pending);
  const refresh = loadPolicy();
  resolveInit();
  await flush();
  expect(request).toHaveBeenCalledTimes(2);
  const signals = request.mock.calls.map(([, { signal }]) => signal);
  policy.scripts = [URL_C];
  await refresh();
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_C]);
  expect(console.warn).not.toHaveBeenCalled();
});

test('discards a policy read if the policy changes before it finishes', async () => {
  let finish;
  managed.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = loadPolicy();
  resolveInit();
  await flush();
  policy.scripts = [URL_B];
  const next = refresh();
  finish({ scripts: [URL_A] });
  await next;
  expect(request.mock.calls.map(([url]) => url)).toEqual([URL_B]);
});

test('installs matching metadata from concurrent downloads only once', async () => {
  policy.scripts = [URL_A, URL_B];
  request.mockResolvedValue({ data: codeFor('Same script') });
  await apply();
  expect(request).toHaveBeenCalledTimes(2);
  expect(parseScript).toHaveBeenCalledTimes(1);
});

test('recognizes a manual installation completed during a policy download', async () => {
  request.mockImplementationOnce(async () => {
    scripts.push({ meta: parseMeta(codeFor(URL_A)), custom: {}, config: {} });
    return { data: codeFor(URL_A) };
  });
  await apply();
  expect(parseScript).not.toHaveBeenCalled();
});

test('allows slow downloads without blocking other scripts', async () => {
  jest.useFakeTimers();
  policy.scripts = [URL_A, URL_B];
  let finish;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = loadPolicy();
  resolveInit();
  const done = refresh();
  await jest.advanceTimersByTimeAsync(60e3);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][1].signal.aborted).toBe(false);
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_B]);
  finish({ data: codeFor(URL_A) });
  await done;
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_B, URL_A]);
  expect(jest.getTimerCount()).toBe(0);
});

test('keeps the MV3 worker alive until policy installation completes', async () => {
  loadPolicy();
  __.MV3 = true;
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
  await apply();
  await flush();
  expect(parseScript).toHaveBeenCalledTimes(1);
  expect(setIntervalSpy).toHaveBeenCalledWith(chrome.runtime.getPlatformInfo, 25e3);
  expect(clearIntervalSpy).toHaveBeenCalled();
});

test('does not install twice in a split incognito context', async () => {
  init.inIncognitoContext = true;
  await apply();
  expect(onChanged.addListener).not.toHaveBeenCalled();
  expect(managed.get).not.toHaveBeenCalled();
  expect(parseScript).not.toHaveBeenCalled();
});
