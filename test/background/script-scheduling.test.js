import { getScriptsByURL } from '@/background/utils/db';
import { init } from '@/background/utils/init';
import { aliveScripts, getDefaultCustom, parseMeta } from '@/background/utils/script';

jest.mock('@/background/utils/icon', () => ({}));
jest.mock('@/background/utils/on-installed', () => ({ NEW_INSTALL: '0' }));
jest.mock('@/background/utils/permissions', () => ({}));
jest.mock('@/background/utils/tabs', () => ({}));
jest.mock('@/background/utils/url', () => ({}));
jest.mock('@/background/utils/storage-cache', () => ({}));
jest.mock('@/background/utils/options', () => ({
  hookOptionsInit: () => {},
  initOptions: () => {},
}));

const url = 'https://example.org/';
const addScript = (id, text = '') => {
  const script = {
    config: { enabled: 1 },
    custom: { ...getDefaultCustom(), pathMap: {} },
    meta: parseMeta(`// ==UserScript==\n// @match *://example.org/*\n${text}\n// ==/UserScript==`),
    props: { id },
  };
  aliveScripts.push(script);
  return script;
};

beforeAll(async () => {
  await init;
});

beforeEach(() => {
  aliveScripts.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('keeps normal, private, and container candidates isolated on the same URL', () => {
  addScript(1);
  addScript(2, '// @run-in normal-tabs');
  addScript(3, '// @run-in incognito-tabs');
  addScript(4, '// @run-in container-id-2\n// @run-in container-id-3');
  expect(getScriptsByURL(url, true, null, {}, { incognito: false })).toEqual({
    1: 'more', 2: 'more',
  });
  expect(getScriptsByURL(url, true, null, {}, { incognito: true })).toEqual({
    1: 'more', 3: 'more',
  });
  expect(getScriptsByURL(url, true, null, {}, {
    incognito: false, cookieStoreId: 'firefox-container-3',
  })).toEqual({ 1: 'more', 3: 'more', 4: 'more' });
  expect(getScriptsByURL(url, true, null, {})).toEqual({ 1: 'more' });
});

test('delivers manual scripts without scheduling them as automatic delayed scripts', async () => {
  const script = addScript(1, '// @run-at context-menu\n// @sandbox DOM\n// @unwrap');
  jest.spyOn(browser.storage.local, 'get').mockResolvedValue({ 'code:1': 'manual source' });
  const env = getScriptsByURL(url, true, [], null, { incognito: false });
  await env.promise;
  expect(env.scripts).toEqual([script]);
  expect(env.runAt).toEqual({ 1: 'context-menu' });
  expect(env.more.scripts).toEqual([]);
});

test('keeps URL exclusions and noframes effective for manual scripts', () => {
  addScript(1, '// @run-at context-menu\n// @exclude *://example.org/*');
  addScript(2, '// @run-at context-menu\n// @noframes');
  expect(getScriptsByURL(url, false, null, {}, { incognito: false })).toEqual({});
});

test('prepares only the explicitly requested manual script', async () => {
  addScript(1, '// @run-at document-start');
  const selected = addScript(2, '// @run-at context-menu');
  jest.spyOn(browser.storage.local, 'get').mockResolvedValue({
    'code:1': 'automatic source', 'code:2': 'manual source',
  });
  const env = getScriptsByURL(url, true, [], null, { incognito: false }, 2);
  await env.promise;
  expect(env.scripts).toEqual([selected]);
  expect(env.ids).toEqual([2]);
});
