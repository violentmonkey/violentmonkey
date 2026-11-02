import * as bridge from '@/injected/content/bridge';
import { restoreMcp, setMcpToken } from '@/injected/content/mcp';
import { sendCmd } from '@/injected/content/util';

jest.mock('@/injected/content/bridge', () => ({
  addHandlers: jest.fn(),
  addBackgroundHandlers: jest.fn(),
  ids: {},
  post: jest.fn(),
}));
jest.mock('@/injected/content/util', () => ({ sendCmd: jest.fn() }));

const handlers = bridge.addHandlers.mock.calls[0][0];
const onCall = bridge.addBackgroundHandlers.mock.calls[0][0].McpCall;
const mcpContext = { sessionId: 'grant-session', pageId: 'page-one' };

beforeEach(() => {
  bridge.post.mockClear();
  sendCmd.mockReset().mockResolvedValue(true);
  bridge.ids[1] = PAGE;
  bridge.ids[2] = CONTENT;
  setMcpToken(Promise.resolve({ mcpToken: 'document-one', mcpContext }));
});

test('registration waits for host response even with early cached injection', async () => {
  let resolve;
  setMcpToken(new Promise(ok => { resolve = ok; }));
  const registering = handlers.RegisterMcpHandler({ id: 1 }, PAGE);
  expect(sendCmd).not.toHaveBeenCalled();
  resolve({ mcpToken: 'fast-path-token' });
  await registering;
  expect(sendCmd).toHaveBeenCalledWith('RegisterMcpHandler', { id: 1, token: 'fast-path-token' });
});

test('routes calls to the correct realm without exposing the document token', async () => {
  await handlers.RegisterMcpHandler({ id: 2 }, CONTENT);
  expect(await onCall({ id: 2, callId: 'call', token: 'document-one', params: [1] })).toBe(true);
  expect(bridge.post).toHaveBeenCalledWith('McpCall', { id: 2, callId: 'call', params: [1] }, CONTENT);
  expect(await onCall({ id: 2, callId: 'call', token: 'stale' })).toBe(false);
});

test('restores registered handlers in both realms and gates reports/calls on the new token', async () => {
  await handlers.RegisterMcpHandler({ id: 1 }, PAGE);
  await handlers.RegisterMcpHandler({ id: 2 }, CONTENT);
  let resolveRestore;
  sendCmd.mockImplementation(cmd => cmd === 'McpRestoreDocument'
    ? new Promise(resolve => { resolveRestore = resolve; }) : Promise.resolve(true));
  sendCmd.mockClear();
  const restoring = restoreMcp();
  const report = handlers.ScriptResult({ id: 1, json: '0' }, PAGE);
  const call = onCall({ id: 2, callId: 'restored-call', token: 'restored', params: [1] });
  await Promise.resolve();
  expect(sendCmd).toHaveBeenCalledTimes(1);
  expect(sendCmd).toHaveBeenCalledWith('McpRestoreDocument', { ...mcpContext, scriptIds: [1, 2] });
  expect(bridge.post).not.toHaveBeenCalled();

  resolveRestore({ mcpToken: 'restored' });
  await Promise.all([restoring, report]);
  expect(await call).toBe(true);
  expect(sendCmd).toHaveBeenCalledWith('ScriptResult', { id: 1, json: '0', token: 'restored' });
  expect(bridge.post).toHaveBeenCalledWith('McpCall', { id: 2, callId: 'restored-call', params: [1] }, CONTENT);
  expect(await onCall({ id: 1, token: 'document-one' })).toBe(false);
});

test('restores result-only scripts without registering nonexistent call handlers', async () => {
  sendCmd.mockResolvedValue({ mcpToken: 'restored' });
  await restoreMcp();
  expect(sendCmd).toHaveBeenCalledWith('McpRestoreDocument', { ...mcpContext, scriptIds: [] });
  await handlers.ScriptResult({ id: 1, json: 'false' }, PAGE);
  expect(sendCmd).toHaveBeenLastCalledWith('ScriptResult', { id: 1, json: 'false', token: 'restored' });
});

test('does not recover failed registrations or restore a page that was never authorized', async () => {
  sendCmd.mockRejectedValueOnce(new Error('Script removed'));
  await expect(handlers.RegisterMcpHandler({ id: 1 }, PAGE)).rejects.toThrow('Script removed');
  sendCmd.mockResolvedValue({ mcpToken: 'restored' });
  await restoreMcp();
  expect(sendCmd).toHaveBeenLastCalledWith('McpRestoreDocument', { ...mcpContext, scriptIds: [] });
  sendCmd.mockClear();
  setMcpToken(Promise.resolve({}));
  await restoreMcp();
  expect(sendCmd).not.toHaveBeenCalled();
});

test('failed restoration disables the old channel without an unhandled rejection', async () => {
  await handlers.RegisterMcpHandler({ id: 1 }, PAGE);
  sendCmd.mockRejectedValue(new Error('MCP authorization changed'));
  await restoreMcp();
  sendCmd.mockClear();
  await expect(handlers.ScriptResult({ id: 1, json: '0' }, PAGE)).rejects.toThrow(/unavailable/);
  expect(await onCall({ id: 1, token: 'document-one' })).toBe(false);
  await restoreMcp();
  expect(sendCmd).not.toHaveBeenCalled();
});

test('rejects ungranted documents and mismatched script realms', async () => {
  await expect(handlers.ScriptResult({ id: 1, json: '0' }, CONTENT)).rejects.toThrow(/unavailable/);
  setMcpToken(Promise.resolve({}));
  await expect(handlers.RegisterMcpHandler({ id: 1 }, PAGE)).rejects.toThrow(/unavailable/);
  expect(sendCmd).not.toHaveBeenCalled();
});
