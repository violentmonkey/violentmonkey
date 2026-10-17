import { parseMeta } from '@/background/utils/script';

const URL_A = 'https://example.com/a.user.js';
const URL_B = 'https://example.com/b.user.js';
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
  managed = { get: jest.fn(async () => policy) };
  onChanged = { addListener: jest.fn() };
  browser.storage.managed = managed;
  browser.storage.onChanged = onChanged;
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
  delete browser.storage.onChanged;
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete __.MV3;
});

function loadPolicy() {
  return require('@/background/utils/policy').applyScriptPolicy;
}

async function apply() {
  const refresh = loadPolicy();
  resolveInit();
  await refresh();
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

test('ignores an unconfigured Firefox policy and can process a later change', async () => {
  managed.get.mockRejectedValueOnce(new Error('Managed storage manifest not found'));
  const refresh = await apply();
  expect(request).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  await refresh();
  expect(parseScript).toHaveBeenCalledTimes(1);
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
  await listener({ scripts: { newValue: [URL_B] } }, 'local');
  await listener({ other: { newValue: true } }, 'managed');
  expect(managed.get).toHaveBeenCalledTimes(reads);
  policy.scripts = [URL_B];
  await listener({ scripts: { newValue: [URL_B] } }, 'managed');
  policy = {};
  await listener({ scripts: { oldValue: [URL_B] } }, 'managed');
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

test('recognizes a manual installation completed during a policy download', async () => {
  request.mockImplementationOnce(async () => {
    scripts.push({ meta: parseMeta(codeFor(URL_A)), custom: {}, config: {} });
    return { data: codeFor(URL_A) };
  });
  await apply();
  expect(parseScript).not.toHaveBeenCalled();
});

test('times out a stalled download and proceeds to the next script', async () => {
  jest.useFakeTimers();
  policy.scripts = [URL_A, URL_B];
  request.mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  const refresh = loadPolicy();
  resolveInit();
  const done = refresh();
  await jest.advanceTimersByTimeAsync(30e3);
  await done;
  expect(parseScript.mock.calls.map(([src]) => src.url)).toEqual([URL_B]);
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
