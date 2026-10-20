import { getDefaultCustom, parseMeta } from '@/background/utils/script';

jest.mock('@/background/utils/db', () => ({
  getScriptById: id => require('@/background/utils/script').aliveScripts
    .find(script => script.props.id === +id),
}));
jest.mock('@/background/utils/options', () => ({
  getOption: () => true,
  hookOptions: () => {},
  hookOptionsInit: () => {},
}));
jest.mock('@/background/utils/tabs', () => ({
  injectableRe: /^(https?|file):/,
  tabsOnActivated: { addListener: () => {} },
  tabsOnUpdated: { addListener: () => {} },
}));

const { aliveScripts } = require('@/background/utils/script');
let menus;
let api;
const tab = { id: 10, url: 'https://example.org/', incognito: false };
const addScript = (id, text, config = {}) => {
  aliveScripts.push({
    config: { enabled: 1, ...config },
    custom: getDefaultCustom(),
    meta: parseMeta(`// ==UserScript==\n// @name script ${id}\n${text}\n// ==/UserScript==`),
    props: { id },
  });
};

beforeAll(() => {
  __.MV3 = true;
  chrome.storage.session = {
    get: async () => ({ contextMenuScriptIds: ['run-script:999'] }),
    set: jest.fn(async () => {}),
  };
  chrome.contextMenus = {
    create: item => menus.set(item.id, item),
    remove: id => menus.delete(id),
    onClicked: { addListener: () => {} },
  };
  browser.tabs.get = async () => tab;
  browser.tabs.query = async () => [tab];
  browser.tabs.sendMessage = jest.fn(async () => true);
  api = require('@/background/utils/context-menu-scripts');
});

beforeEach(() => {
  menus = new Map([['run-script:999', { title: 'stale script' }]]);
  aliveScripts.length = 0;
  browser.tabs.sendMessage.mockClear();
});

afterAll(() => {
  delete __.MV3;
});

test('shows eligible manual scripts in the browser context menu', async () => {
  addScript(1, '// @run-at context-menu\n// @run-in normal-tabs');
  addScript(2, '// @run-at document-end');
  addScript(3, '// @run-at context-menu\n// @run-in incognito-tabs');
  addScript(4, '// @run-at context-menu', { enabled: 0 });
  addScript(5, '// @run-at context-menu\n// @exclude *://example.org/*');
  await api.rebuildContextMenuScripts(tab);
  expect([...menus.values()].map(({ title }) => title)).toEqual(['script 1']);
  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    contextMenuScriptIds: ['run-script:1'],
  });
});

test('runs the selected manual script in its requested frame', async () => {
  addScript(1, '// @run-at context-menu');
  expect(await api.runContextMenuScript({ id: 1, tabId: 10, frameId: 3 })).toBe(true);
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(10, {
    cmd: 'RunContextMenuScript', data: 1,
  }, { frameId: 3 });
});

test('rejects automatic, disabled, and wrong-context scripts at activation', async () => {
  addScript(1, '// @run-at document-end');
  addScript(2, '// @run-at context-menu', { enabled: 0 });
  addScript(3, '// @run-at context-menu\n// @run-in incognito-tabs');
  for (const id of [1, 2, 3, 999]) {
    expect(await api.runContextMenuScript({ id, tabId: 10 })).toBe(false);
  }
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});
