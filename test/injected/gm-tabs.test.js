const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
let sender;
let realm;
let makeGmApiWrapper;
let contentBridge;
let webBridge;

function makeApi(id, grant) {
  return makeGmApiWrapper({
    id,
    displayName: `Script ${id}`,
    meta: { grant, resources: {} },
    gmi: {},
  }).gm;
}

beforeAll(() => {
  browser.runtime.onMessage = { addListener: () => {} };
  const { commands } = require('@/background/utils/init');
  require('@/background/utils/gm-tabs');
  browser.runtime.sendMessage = async ({ cmd, data }) => (
    copy(await commands[cmd](copy(data), copy(sender)))
  );
  contentBridge = require('@/injected/content/bridge');
  require('@/injected/content/gm-tabs');
  webBridge = require('@/injected/web/bridge');
  global.VMInitInjection = null;
  require('@/injected/web/index');
  ({ makeGmApiWrapper } = require('@/injected/web/gm-api-wrapper'));
  webBridge.setPost((cmd, data, node) => contentBridge.onHandle({ cmd, data, node }, realm));
  contentBridge.setPost((cmd, data, targetRealm, node) => (
    webBridge.onHandle({ cmd, data, node })
  ));
});

beforeEach(() => {
  const { gmTabs } = require('@/background/utils/session-data');
  for (const id of Object.keys(gmTabs)) delete gmTabs[id];
  sender = { tab: { id: 10 } };
  realm = PAGE;
  contentBridge.init({
    [IDS]: { 1: PAGE, 2: PAGE, 3: CONTENT },
    [INJECT_INTO]: PAGE,
  });
});

test('supports legacy callbacks and returns no synchronous tab state', async () => {
  const gm = makeApi(1, ['GM_getTab', 'GM_saveTab', 'GM_getTabs']);
  expect(gm.GM_getTab).toEqual(expect.any(Function));
  const fresh = new Promise(resolve => {
    expect(gm.GM_getTab(resolve)).toBeUndefined();
  });
  expect(await fresh).toEqual({});
  const saved = new Promise(resolve => {
    expect(gm.GM_saveTab({ visits: 2 }, (...args) => resolve(args))).toBeUndefined();
  });
  expect(await saved).toEqual([]);
  expect(await new Promise(resolve => gm.GM_getTab(resolve))).toEqual({ visits: 2 });
  expect(await new Promise(resolve => gm.GM_getTabs(resolve))).toEqual({ 10: { visits: 2 } });
});

test('supports all Promise aliases with separately granted APIs', async () => {
  const { GM: gm } = makeApi(2, ['GM.getTab', 'GM.saveTab', 'GM.getTabs']);
  expect(gm.getTab).toEqual(expect.any(Function));
  const reading = gm.getTab();
  expect(reading).toBeInstanceOf(Promise);
  expect(await reading).toEqual({});
  expect(await gm.saveTab({ title: 'remembered' })).toBeUndefined();
  expect(await gm.getTab()).toEqual({ title: 'remembered' });
  expect(await gm.getTabs()).toEqual({ 10: { title: 'remembered' } });
});

test('does not expose APIs without the corresponding grant', () => {
  for (const grant of [[], ['none'], ['GM_getValue']]) {
    const gm = makeApi(1, grant);
    for (const name of ['getTab', 'saveTab', 'getTabs']) {
      expect(gm[`GM_${name}`]).toBeUndefined();
      expect(gm.GM[name]).toBeUndefined();
    }
  }
  const gm = makeApi(1, ['GM_getTab', 'GM.getTabs']);
  expect(gm.GM_getTab).toEqual(expect.any(Function));
  expect(gm.GM.getTabs).toEqual(expect.any(Function));
  expect(gm.GM_getTabs).toBeUndefined();
  expect(gm.GM.getTab).toBeUndefined();
  expect(gm.GM_saveTab).toBeUndefined();
  expect(gm.GM.saveTab).toBeUndefined();
});

test('binds state access to the script and browser tab rather than caller data', async () => {
  const first = makeApi(1, ['GM.getTab', 'GM.saveTab', 'GM.getTabs']).GM;
  const second = makeApi(2, ['GM.getTab', 'GM.saveTab', 'GM.getTabs']).GM;
  expect(first.saveTab).toEqual(expect.any(Function));
  await first.saveTab.call({ id: 2 }, { id: 2, tabId: 99, secret: 'first' });
  await second.saveTab({ secret: 'second' });
  expect(await first.getTab.call({ id: 2 })).toEqual({ id: 2, tabId: 99, secret: 'first' });
  expect(await second.getTabs()).toEqual({ 10: { secret: 'second' } });
  sender = { tab: { id: 11 } };
  expect(await first.getTab()).toEqual({});
  await first.saveTab({ secret: 'another tab' });
  expect(await first.getTabs()).toEqual({
    10: { id: 2, tabId: 99, secret: 'first' },
    11: { secret: 'another tab' },
  });
});

test('does not save mutations until saveTab is called', async () => {
  const { GM: gm } = makeApi(1, ['GM.getTab', 'GM.saveTab']);
  expect(gm.saveTab).toEqual(expect.any(Function));
  const saved = { nested: { value: 'saved' } };
  await gm.saveTab(saved);
  saved.nested.value = 'changed locally';
  const first = await gm.getTab();
  expect(first).toEqual({ nested: { value: 'saved' } });
  first.nested.value = 'changed after reading';
  expect(await gm.getTab()).toEqual({ nested: { value: 'saved' } });
});

test('supports saving without a legacy callback', async () => {
  const gm = makeApi(1, ['GM_saveTab', 'GM.getTab']);
  expect(gm.GM_saveTab).toEqual(expect.any(Function));
  expect(gm.GM_saveTab({ fireAndForget: true })).toBeUndefined();
  expect(await gm.GM.getTab()).toEqual({ fireAndForget: true });
});

test('rejects Promise access when the browser sender has no tab', async () => {
  const { GM: gm } = makeApi(1, ['GM.getTab']);
  expect(gm.getTab).toEqual(expect.any(Function));
  sender = {};
  await expect(gm.getTab()).rejects.toThrow(/tab/i);
});

test('rejects access from a script outside the sending realm', async () => {
  const { GM: gm } = makeApi(3, ['GM.getTab', 'GM.saveTab']);
  expect(gm.getTab).toEqual(expect.any(Function));
  await expect(gm.getTab()).rejects.toThrow(/script/i);
  realm = CONTENT;
  await gm.saveTab({ content: true });
  expect(await gm.getTab()).toEqual({ content: true });
});
