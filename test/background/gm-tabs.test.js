const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const originalBrowser = browser;
const originalFlags = { ...__ };
const OriginalBroadcastChannel = global.BroadcastChannel;

function loadTabState(mv3, stored = {}) {
  jest.resetModules();
  __.MV3 = mv3;
  global.BroadcastChannel = class {};
  const removed = [];
  const replaced = [];
  global.chrome = global.browser = {
    ...originalBrowser,
    storage: {
      ...originalBrowser.storage,
      session: {
        get: async () => copy(stored),
        set: async data => Object.assign(stored, copy(data)),
      },
    },
    runtime: {
      ...originalBrowser.runtime,
      sendMessage: () => {},
      onMessage: { addListener: () => {} },
    },
    tabs: {
      ...originalBrowser.tabs,
      sendMessage: () => {},
      onRemoved: { addListener: listener => removed.push(listener) },
      onReplaced: { addListener: listener => replaced.push(listener) },
    },
  };
  const { commands } = require('@/background/utils/init');
  require('@/background/utils/gm-tabs');
  return {
    run(cmd, id, tabId, tab) {
      expect(commands[cmd]).toEqual(expect.any(Function));
      return commands[cmd]({ id, tab }, {
        tab: tabId == null ? undefined : { id: tabId },
      });
    },
    remove: async id => Promise.all(removed.map(listener => listener(id))),
    replace: async (addedId, removedId) => Promise.all(
      replaced.map(listener => listener(addedId, removedId))
    ),
  };
}

beforeEach(() => jest.useFakeTimers());

afterEach(async () => {
  await jest.runOnlyPendingTimersAsync();
  jest.useRealTimers();
  global.chrome = global.browser = originalBrowser;
  global.BroadcastChannel = OriginalBroadcastChannel;
  Object.assign(__, originalFlags);
  delete __.MV3;
});

describe.each([false, true])('tab state in MV3=%s', mv3 => {
  test('returns an empty object until tab information is saved', async () => {
    const api = loadTabState(mv3);
    expect(await api.run('GetTab', 1, 10)).toEqual({});
    expect(await api.run('GetTabs', 1, 10)).toEqual({});
  });

  test('keeps script state separate across tabs and scripts', async () => {
    const api = loadTabState(mv3);
    await api.run('SaveTab', 1, 10, { value: 'first tab' });
    await api.run('SaveTab', 1, 11, { value: 'second tab' });
    await api.run('SaveTab', 2, 10, { value: 'other script' });
    expect(await api.run('GetTab', 1, 10)).toEqual({ value: 'first tab' });
    expect(await api.run('GetTab', 1, 11)).toEqual({ value: 'second tab' });
    expect(await api.run('GetTabs', 1, 10)).toEqual({
      10: { value: 'first tab' },
      11: { value: 'second tab' },
    });
    expect(await api.run('GetTabs', 2, 11)).toEqual({ 10: { value: 'other script' } });
  });

  test('replaces saved information and retains empty objects', async () => {
    const api = loadTabState(mv3);
    await api.run('SaveTab', 1, 10, { old: true });
    await api.run('SaveTab', 1, 10, {});
    expect(await api.run('GetTabs', 1, 10)).toEqual({ 10: {} });
  });

  test('removes closed tabs from every script without affecting other tabs', async () => {
    const api = loadTabState(mv3);
    await api.run('SaveTab', 1, 10, { value: 'closed' });
    await api.run('SaveTab', 1, 11, { value: 'open' });
    await api.run('SaveTab', 2, 10, { value: 'also closed' });
    await api.remove(10);
    expect(await api.run('GetTabs', 1, 11)).toEqual({ 11: { value: 'open' } });
    expect(await api.run('GetTabs', 2, 11)).toEqual({});
  });

  test('removes replaced tabs from current and persisted script state', async () => {
    const stored = {};
    let api = loadTabState(mv3, stored);
    await api.run('SaveTab', 1, 10, { value: 'replaced' });
    await api.run('SaveTab', 1, 11, { value: 'open' });
    await api.run('SaveTab', 2, 10, { value: 'also replaced' });
    await api.replace(12, 10);
    expect(await api.run('GetTabs', 1, 11)).toEqual({ 11: { value: 'open' } });
    expect(await api.run('GetTabs', 2, 11)).toEqual({});
    if (mv3) {
      await jest.runOnlyPendingTimersAsync();
      api = loadTabState(true, stored);
      expect(await api.run('GetTabs', 1, 11)).toEqual({ 11: { value: 'open' } });
      expect(await api.run('GetTabs', 2, 11)).toEqual({});
    }
  });

  test.each([undefined, -1])('rejects state access without a real tab: %s', async tabId => {
    const api = loadTabState(mv3);
    for (const cmd of ['GetTab', 'SaveTab', 'GetTabs']) {
      await expect(api.run(cmd, 1, tabId, {})).rejects.toThrow(/tab/i);
    }
  });

  test.each(['__proto__', 'constructor', 0, -1, 1.5])('rejects invalid script id %s', async id => {
    const api = loadTabState(mv3);
    await expect(api.run('SaveTab', id, 10, { value: true })).rejects.toThrow(/script/i);
  });

  test.each([null, false, 1, 'data'])('rejects non-object tab information: %s', async tab => {
    const api = loadTabState(mv3);
    await expect(api.run('SaveTab', 1, 10, tab)).rejects.toThrow(/object/i);
    expect(await api.run('GetTabs', 1, 10)).toEqual({});
  });
});

test('restores saved data after an MV3 worker restart', async () => {
  const stored = {};
  let api = loadTabState(true, stored);
  await api.run('SaveTab', 1, 10, { value: 'survives suspension' });
  await jest.runOnlyPendingTimersAsync();
  api = loadTabState(true, stored);
  expect(await api.run('GetTab', 1, 10)).toEqual({ value: 'survives suspension' });
});

test('waits for session restore before cleaning up a closed tab', async () => {
  const stored = {
    init: 1,
    gmTabs: { 1: { 10: { closed: true }, 11: { open: true } } },
  };
  let api = loadTabState(true, stored);
  await api.remove(10);
  await jest.runOnlyPendingTimersAsync();
  api = loadTabState(true, stored);
  expect(await api.run('GetTabs', 1, 11)).toEqual({ 11: { open: true } });
});
