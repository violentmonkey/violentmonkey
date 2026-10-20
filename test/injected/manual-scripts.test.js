import { META_STR } from '@/common/consts';

jest.mock('@/injected/content/cmd-run', () => ({ Run: jest.fn() }));
jest.mock('@/injected/content/bridge', () => {
  const bridge = {
    __esModule: true,
    ids: {},
    grantless: {},
    onScripts: [],
    addHandlers: jest.fn(),
    addBackgroundHandlers: jest.fn(),
    post: jest.fn(),
    setCache: val => (bridge.cache = val || {}),
    setPathMaps: val => (bridge.pathMaps = val),
    setPost: val => (bridge.post = val),
  };
  return bridge;
});
jest.mock('@/injected/content/util', () => ({
  ...jest.requireActual('@/injected/content/util'),
  sendCmd: jest.fn(async () => ({})),
}));

test('runs a manual content script only when explicitly selected, including repeated clicks', async () => {
  const contentMessages = [];
  __.INIT_FUNC_NAME = 'manualScriptInitializer';
  global[__.INIT_FUNC_NAME] = () => () => (cmd, data) => contentMessages.push({ cmd, data });
  const { injectScripts, runContextMenuScript } = require('@/injected/content/inject');
  const { sendCmd } = require('@/injected/content/util');
  const script = {
    id: 1,
    injectInto: 'content',
    runAt: 'context-menu',
    code: '',
    key: { data: 'manual-data', win: 'manual-window' },
    meta: { grant: [], unwrap: true },
    [META_STR]: ['// @run-at context-menu'],
    gmi: {},
  };
  await injectScripts({ scripts: [script], cache: {} }, { gmi: {} });
  expect(contentMessages).toEqual([]);
  expect(sendCmd).not.toHaveBeenCalled();
  expect(await runContextMenuScript(999)).toBe(false);
  sendCmd.mockImplementation(async cmd => cmd === 'GetContextMenuScript' && ({
    scripts: [{ ...script, key: { data: 'fresh-data', win: 'fresh-window' } }],
    cache: {},
  }));
  expect(await runContextMenuScript(1)).toBe(true);
  expect(contentMessages.filter(({ cmd }) => cmd === 'ScriptData')).toHaveLength(1);
  expect(sendCmd).toHaveBeenCalledWith('InjectionFeedback', expect.objectContaining({
    content: [[1, 'fresh-data']],
  }));
  expect(await runContextMenuScript(1)).toBe(true);
  expect(contentMessages.filter(({ cmd }) => cmd === 'ScriptData')).toHaveLength(2);
  sendCmd.mockResolvedValue(false);
  expect(await runContextMenuScript(1)).toBe(false);
  expect(contentMessages.filter(({ cmd }) => cmd === 'ScriptData')).toHaveLength(2);
});
