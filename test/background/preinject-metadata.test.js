import { normalizeScriptRealm, prepare, triageRealms } from '@/background/utils/preinject-prepare';
import { __CODE, META_STR } from '@/common/consts';
import { aliveScripts } from '@/background/utils/script';
import { getScriptsByURL } from '@/background/utils/db';
import { cache, injectContentRealm, registerScriptData } from '@/background/utils/preinject-core';

jest.mock('@/background/utils/preinject-core', () => ({
  injectInto: 'auto',
  injectContentRealm: jest.fn(),
  cache: require('@/common/cache').default({ lifetime: 1e3 }),
  expose: {},
  isApplied: true,
  ffInject: true,
  lastRegTime: 0,
  lastRegDuration: 0,
  contentScriptsAPI: {},
  propsToClear: {},
  registerScriptData: jest.fn(),
}));
jest.mock('@/background/utils/db', () => ({ getScriptsByURL: jest.fn() }));
jest.mock('@/background/utils/dnr', () => ({}));
jest.mock('@/background/utils/ua', () => ({}));

afterEach(() => {
  aliveScripts.length = 0;
  cache.destroy();
  jest.clearAllMocks();
  jest.useRealTimers();
});

test.each([
  ['raw', 'auto'],
  ['DOM', 'content'],
  ['JavaScript', 'auto'],
  ['unknown', 'auto'],
  [undefined, 'auto'],
])('selects %s sandbox as %s realm', (sandbox, expected) => {
  expect(normalizeScriptRealm({}, { sandbox })).toBe(expected);
});

test.each([
  [{ injectInto: 'auto' }, { injectInto: 'page', sandbox: 'DOM' }, 'auto'],
  [{ injectInto: 'page' }, { injectInto: 'content', sandbox: 'DOM' }, 'page'],
  [{}, { injectInto: 'page', sandbox: 'DOM' }, 'page'],
  [{}, { injectInto: 'content', sandbox: 'raw' }, 'content'],
])('preserves explicit VM realm settings %j and %j', (custom, meta, expected) => {
  expect(normalizeScriptRealm(custom, meta)).toBe(expected);
});

test.each(['raw', 'JavaScript'])(
  'falls back to content for %s when CSP or XML prevents page injection', sandbox => {
    jest.useFakeTimers();
    const script = {
      id: 7,
      injectInto: normalizeScriptRealm({}, { sandbox }),
      runAt: 'start',
      key: { data: 'sandbox-script' },
      [META_STR]: ['metadata'],
      [__CODE]: ['source();'],
    };
    const bag = { inject: {}, more: { scripts: [] } };
    triageRealms([script], true, 10, 3, bag);
    jest.runAllTimers();
    expect(script.code).toBe('');
    expect(bag.inject.page).toBe(false);
    expect(injectContentRealm).toHaveBeenCalledWith([[7, 'sandbox-script']], 10, 3);
  }
);

test.each(['raw', 'JavaScript'])(
  'prefers the page realm for %s when it is available', sandbox => {
    jest.useFakeTimers();
    const script = {
      id: 7,
      injectInto: normalizeScriptRealm({}, { sandbox }),
      runAt: 'start',
      key: { data: 'sandbox-script' },
      [META_STR]: ['metadata'],
      [__CODE]: ['source();'],
    };
    const bag = { inject: {}, more: { scripts: [] } };
    triageRealms([script], false, 10, 3, bag);
    jest.runAllTimers();
    expect(script.code).toEqual(['source();']);
    expect(bag.inject.page).toBe(true);
    expect(injectContentRealm).not.toHaveBeenCalled();
  }
);

test.each([
  [{ injectInto: 'page' }, { sandbox: 'raw' }],
  [{}, { injectInto: 'page', sandbox: 'raw' }],
  [{ injectInto: 'page' }, { sandbox: 'JavaScript' }],
  [{}, { injectInto: 'page', sandbox: 'JavaScript' }],
])('keeps explicit VM page settings strict for %j and %j', (custom, meta) => {
  jest.useFakeTimers();
  const script = {
    id: 7,
    injectInto: normalizeScriptRealm(custom, meta),
    runAt: 'start',
    key: { data: 'sandbox-script' },
    [META_STR]: ['metadata'],
    [__CODE]: ['source();'],
  };
  triageRealms([script], true, 10, 3);
  jest.runAllTimers();
  expect(script.code).toBe(ID_BAD_REALM);
  expect(injectContentRealm).not.toHaveBeenCalled();
});

test('does not execute manual content scripts during automatic realm triage', () => {
  jest.useFakeTimers();
  const script = {
    id: 1,
    injectInto: 'content',
    runAt: 'context-menu',
    [META_STR]: ['// @run-at context-menu'],
    key: { data: 'manual' },
  };
  triageRealms([script], false, 10, 0);
  jest.runAllTimers();
  expect(injectContentRealm).not.toHaveBeenCalled();
  jest.useRealTimers();
});

const makeEnv = () => ({
  scripts: [], ids: [], allIds: {}, value: {}, cache: {}, more: { ids: [], scripts: [] },
});

test('keeps context-restricted eligibility out of URL-wide content registrations', async () => {
  aliveScripts.push({ meta: { runIn: ['normal-tabs'] } });
  getScriptsByURL.mockReturnValue(makeEnv());
  await prepare('normal', 'https://example.org/', true, false, { incognito: false }).promise;
  expect(registerScriptData).not.toHaveBeenCalled();
});

test('preserves fast content registration for scripts without context restrictions', async () => {
  getScriptsByURL.mockReturnValue(makeEnv());
  await prepare('public', 'https://example.org/', true, false, { incognito: false }).promise;
  expect(registerScriptData).toHaveBeenCalledTimes(1);
});

test('reports real tab privacy in the preinjection payload', async () => {
  getScriptsByURL.mockReturnValue(makeEnv());
  const bag = await prepare('private', 'https://example.org/', true, false, {
    incognito: true,
  }).promise;
  expect(bag.inject.info.gmi.isIncognito).toBe(true);
});
