import storage from '@/background/utils/storage';
import protectSourceStorage, { decodeSource } from '@/background/utils/storage-source';

const source = "fn('', 'plain', '{}', ', ', '\\'queued\\'');\nconst text = 'Grüße 😀';\nconst lone = '\ud800';";
let persisted;
let transform;

beforeEach(() => {
  persisted = {};
  transform = value => value;
  jest.spyOn(browser.storage.local, 'get').mockImplementation(async keys => {
    const names = keys == null ? Object.keys(persisted)
      : Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(names.filter(key => key in persisted)
      .map(key => [key, JSON.parse(JSON.stringify(persisted[key]))]));
  });
  jest.spyOn(browser.storage.local, 'set').mockImplementation(async data => {
    Object.assign(persisted, JSON.parse(transform(JSON.stringify(data))));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test.each([
  ['collapses quote pairs', value => value.replace(/''/g, "'")],
  ['doubles apostrophes', value => value.replace(/'/g, "''")],
])('preserves saved source when native storage %s', async (_, rewrite) => {
  transform = rewrite;
  await storage.code.setOne(1, source);
  persisted = JSON.parse(JSON.stringify(persisted));
  expect(await storage.code.getOne(1)).toBe(source);
  expect(await storage.code.getMulti([1])).toEqual({ 1: source });
});

test('preserves two empty arguments even when the corrupted script would still parse', async () => {
  transform = value => value.replace(/''/g, "'");
  await storage.code.setOne(1, "fn('', '');");
  expect(await storage.code.getOne(1)).toBe("fn('', '');");
});

test('protects required libraries from native quote corruption', async () => {
  transform = value => value.replace(/''/g, "'");
  await storage.require.setOne('https://example.com/lib.js', source);
  expect(await storage.require.getOne('https://example.com/lib.js')).toBe(source);
});

test('reads unencoded sources from existing installations', async () => {
  persisted['code:1'] = source;
  persisted['req:https://example.com/lib.js'] = source;
  expect(await storage.code.getOne(1)).toBe(source);
  expect(await storage.require.getOne('https://example.com/lib.js')).toBe(source);
});

test('returns decoded source in whole-database reads', async () => {
  transform = value => value.replace(/''/g, "'");
  await storage.code.setOne(1, source);
  await storage.require.setOne('https://example.com/lib.js', source);
  expect(await storage.api.get()).toEqual({
    'code:1': source,
    'req:https://example.com/lib.js': source,
  });
  expect(await storage.code.getOne(2)).toBeUndefined();
});

test('keeps other storage areas unchanged', async () => {
  await storage.value.setOne(1, { title: "a'b", pair: "''" });
  await storage.script.setOne(1, { meta: { name: "a'b" } });
  expect(persisted).toEqual({
    'val:1': { title: "a'b", pair: "''" },
    'scr:1': { meta: { name: "a'b" } },
  });
});

test('protects legacy source before a later native storage restart rewrites quotes', async () => {
  persisted['code:1'] = source;
  const api = protectSourceStorage(browser.storage.local);
  await api.get();
  persisted = JSON.parse(JSON.stringify(persisted).replace(/''/g, "'"));
  expect((await api.get())['code:1']).toBe(source);
});

test('keeps a concurrent save newer than the source being migrated', async () => {
  persisted['code:1'] = source;
  let finishRead;
  browser.storage.local.get.mockImplementationOnce(() => new Promise(resolve => {
    finishRead = resolve;
  }));
  const api = protectSourceStorage(browser.storage.local);
  const read = api.get();
  const save = api.set({ 'code:1': "updated('', '');" });
  await Promise.resolve();
  finishRead({ 'code:1': source });
  await Promise.all([read, save]);
  expect((await api.get())['code:1']).toBe("updated('', '');");
});

test('does not overwrite a newer source from an independent MV3 context during startup', async () => {
  const originalMV3 = __.MV3;
  __.MV3 = true;
  persisted['code:1'] = source;
  let finishRead;
  let started;
  const getStarted = new Promise(resolve => { started = resolve; });
  browser.storage.local.get.mockImplementationOnce(() => new Promise(resolve => {
    finishRead = resolve;
    started();
  }));
  try {
    const first = protectSourceStorage(browser.storage.local);
    const second = protectSourceStorage(browser.storage.local);
    const read = first.get();
    await getStarted;
    await second.set({ 'code:1': "updated('', '');" });
    finishRead({ 'code:1': source });
    await read;
    expect(decodeSource('code:1', persisted['code:1'])).toBe("updated('', '');");
  } finally {
    __.MV3 = originalMV3;
  }
});

test('decodes native storage events before updating a source cache', async () => {
  await storage.code.setOne(1, source);
  expect(decodeSource('code:1', persisted['code:1'])).toBe(source);
  expect(decodeSource('code:1', undefined)).toBeUndefined();
});

test('rejects an invalid encoded source instead of executing damaged text', async () => {
  persisted['code:1'] = { vmSource: 1, data: 'invalid encoding' };
  await expect(storage.code.getOne(1)).rejects.toThrow('Invalid stored userscript source');
});
