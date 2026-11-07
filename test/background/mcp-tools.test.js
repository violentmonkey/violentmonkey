import { createClient } from '@violentmonkey/mcp-client';
import browser from '@/common/browser';
import { keepAlive } from '@/common';
import { commands } from '@/background/utils/init';
import { getScriptById } from '@/background/utils/db';
import { requestMcpConnection } from '@/background/utils/mcp';
import { startDocument } from '@/background/utils/mcp-execution';

jest.mock('@violentmonkey/mcp-client', () => ({
  createClient: jest.fn(),
  ErrorCode: { Denied: 403, NotFound: 404, InvalidParams: 400, Internal: 500 },
  ToolCallError: class extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}), { virtual: true }); // upstream only exposes an ESM import condition
jest.mock('@/common', () => ({ ...jest.requireActual('@/common'), keepAlive: jest.fn() }));
jest.mock('@/background/utils/init', () => {
  const handlers = {};
  return {
    commands: handlers,
    addOwnCommands: obj => Object.assign(handlers, obj),
    addPublicCommands: obj => Object.assign(handlers, obj),
  };
});
jest.mock('@/background/utils/broadcast', () => jest.fn());
jest.mock('@/background/utils/db', () => ({
  getScriptById: jest.fn(id => ({ props: { id }, config: { enabled: 1 } })),
}));
jest.mock('@/background/utils/tabs', () => ({
  tabsOnRemoved: { addListener: jest.fn() },
  getTabUrl: tab => tab.url,
}));
jest.mock('@/background/utils/script', () => ({}));
jest.mock('@/background/utils/storage', () => ({}));
jest.mock('@/background/utils/tester', () => ({}));

let tools;
let mcp;
let token;
const sender = { tab: { id: 7 }, frameId: 0 };
const sum = { name: 'sum', description: 'Echoes params', schema: '{"type":"object"}' };
const call = opts => tools.script_call({ tabId: 7, scriptId: 1, handler: 'sum', ...opts });

beforeEach(() => {
  tools = {};
  let onStatus;
  createClient.mockReturnValue({
    handle: (name, fn) => { tools[name] = fn; },
    on: (event, fn) => { onStatus = fn; },
    connect: () => onStatus('open'),
    close: () => onStatus('closed'),
  });
  browser.tabs.get = jest.fn(async id => ({ id, url: 'https://example.com/' }));
  browser.tabs.sendMessage = jest.fn(async (tabId, { data: { id, token: t, args } }) => {
    commands.McpReturn({ id, callId: args.callId, token: t, json: JSON.stringify(args.params) }, sender);
    return true;
  });
  requestMcpConnection('https://example.com/?port=5678&token=test');
  commands.McpApprove();
  commands.McpGrantTab(7);
  mcp = startDocument(7, 0);
  ({ token } = mcp);
  commands.McpRegister({ id: 1, token, handlers: [sum] }, sender);
});
afterEach(() => commands.McpDisconnect());

test('tool call dispatches to the named handler and returns the matching structured result', async () => {
  const { result } = await call({ params: { rows: [0, false] } });
  expect(result).toMatchObject({
    kind: 'call', status: 'completed', scriptId: 1, handler: 'sum', value: { rows: [0, false] },
  });
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(7, {
    cmd: 'McpCall',
    data: { id: 1, token, args: { callId: result.callId, handler: 'sum', params: { rows: [0, false] } } },
  }, { frameId: 0 });
  expect(await tools.script_results({ tabId: 7, callId: result.callId }))
  .toMatchObject({ entries: [result] });
  expect(await tools.script_handlers({ tabId: 7 })).toEqual({
    scripts: [{
      scriptId: 1,
      frameId: 0,
      handlers: [{ name: 'sum', description: 'Echoes params', inputSchema: { type: 'object' } }],
    }],
  });
});

test('reports and unregistering go through the authorized channel', async () => {
  const { result } = await call({});
  expect(commands.McpReport({ id: 1, token, callId: result.callId, json: '"later"' }, sender)).toBe(true);
  expect(commands.McpReport({ id: 1, token, json: '"event"' }, sender)).toBe(true);
  const { entries } = await tools.script_results({ tabId: 7, scriptId: 1 });
  expect(entries.map(e => [e.kind, e.callId, e.value])).toEqual([
    ['call', result.callId, null], ['report', result.callId, 'later'], ['report', undefined, 'event'],
  ]);
  commands.McpUnregister({ id: 1, token, names: ['sum'] }, sender);
  expect(await tools.script_handlers({ tabId: 7 })).toEqual({ scripts: [] });
  await expect(call({})).rejects.toMatchObject({ code: 404 });
});

test('wait=false returns immediately and repeated IDs do not dispatch again', async () => {
  browser.tabs.sendMessage.mockResolvedValue(true);
  const args = { callId: 'queued', wait: false };
  expect((await call(args)).result.status).toBe('pending');
  expect((await call(args)).result.status).toBe('pending');
  expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
  commands.McpReturn({ id: 1, token, callId: 'queued', json: 'false' }, sender);
  expect((await call({ ...args, wait: true })).result.value).toBe(false);
});

test('MV3 keeps the worker alive while a new call is pending', async () => {
  browser.tabs.sendMessage.mockResolvedValue(true);
  __.MV3 = true;
  try {
    await call({ callId: 'kept', wait: false });
    await call({ callId: 'kept', wait: false });
  } finally {
    delete __.MV3;
  }
  expect(keepAlive).toHaveBeenCalledTimes(1);
  expect(keepAlive).toHaveBeenCalledWith(expect.any(Promise));
});

test('authorization gates calls and reads, and revocation clears results', async () => {
  await expect(tools.script_call({ tabId: 8, scriptId: 1, handler: 'sum' })).rejects.toMatchObject({ code: 403 });
  await call({});
  commands.McpRevokeTab(7);
  await expect(tools.script_results({ tabId: 7 })).rejects.toMatchObject({ code: 403 });
  expect(() => commands.McpReport({ id: 1, token, json: '1' }, sender)).toThrow(/not authorized/);
  expect(() => commands.McpRegister({ id: 1, token, handlers: [sum] }, sender)).toThrow(/not authorized/);
  commands.McpGrantTab(7);
  expect((await tools.script_results({ tabId: 7 })).entries).toEqual([]);
});

test('delivery failures complete the call instead of hanging', async () => {
  browser.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
  const { result } = await call({});
  expect(result).toMatchObject({ status: 'failed', error: 'Receiving end does not exist' });
});

test('restored pages can be called and cannot revive revoked or inactive channels', async () => {
  const data = { sessionId: mcp.sessionId, pageId: mcp.pageId, scripts: [{ id: 1, handlers: [sum] }] };
  startDocument(7, 0);
  expect(() => commands.McpRestoreDocument(data, { ...sender, documentLifecycle: 'cached' }))
  .toThrow(/active document/);
  const restored = commands.McpRestoreDocument(data, { ...sender, documentLifecycle: 'active' });
  expect(restored.token).not.toBe(token);
  const { result } = await call({ params: 'restored' });
  expect(result).toMatchObject({ status: 'completed', value: 'restored' });
  expect(() => commands.McpReport({ id: 1, token, json: '0' }, sender)).toThrow(/different document/);

  commands.McpRevokeTab(7);
  expect(() => commands.McpRestoreDocument(data, sender)).toThrow(/not authorized/);
  commands.McpGrantTab(7);
  startDocument(7, 0);
  expect(() => commands.McpRestoreDocument(data, sender)).toThrow(/authorization changed/);
});

test('restoration skips disabled/deleted handlers without blocking other scripts', async () => {
  startDocument(7, 0);
  getScriptById.mockReturnValueOnce({ config: { enabled: 1 } })
  .mockReturnValueOnce({ config: { enabled: 0 } })
  .mockReturnValueOnce({ config: { removed: 1 } })
  .mockReturnValueOnce(undefined);
  commands.McpRestoreDocument({
    sessionId: mcp.sessionId,
    pageId: mcp.pageId,
    scripts: [1, 2, 3, 4].map(id => ({ id, handlers: [sum] })),
  }, sender);
  expect((await tools.script_handlers({ tabId: 7 })).scripts.map(s => s.scriptId)).toEqual([1]);
});
