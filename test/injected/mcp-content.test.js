import * as bridge from '@/injected/content/bridge';
import { restoreMcp, setMcp } from '@/injected/content/mcp';
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
const context = { sessionId: 'grant-session', pageId: 'page-one' };
const sum = { name: 'sum', description: 'Adds', schema: '{"type":"object"}' };
const ping = { name: 'ping' };
const args = { callId: 'call', handler: 'sum', params: [1] };

beforeEach(() => {
  bridge.post.mockClear();
  sendCmd.mockReset().mockResolvedValue(true);
  bridge.ids[1] = PAGE;
  bridge.ids[2] = CONTENT;
  bridge.ids[3] = ID_BAD_REALM;
  setMcp(Promise.resolve({ mcp: { token: 'document-one', ...context } }));
});

test('registration waits for host response even with early cached injection', async () => {
  let resolve;
  setMcp(new Promise(ok => { resolve = ok; }));
  const registering = handlers.McpRegister({ id: 1, handlers: [sum] }, PAGE);
  expect(sendCmd).not.toHaveBeenCalled();
  resolve({ mcp: { token: 'fast-path-token', ...context } });
  await registering;
  expect(sendCmd).toHaveBeenCalledWith('McpRegister', { id: 1, handlers: [sum], token: 'fast-path-token' });
});

test('routes calls to the correct realm without exposing the document token', async () => {
  expect(await onCall({ id: 2, token: 'document-one', args })).toBe(true);
  expect(bridge.post).toHaveBeenCalledWith('McpCall', { id: 2, args }, CONTENT);
  expect(await onCall({ id: 2, token: 'stale', args })).toBe(false);
  expect(await onCall({ id: 3, token: 'document-one', args })).toBe(false);
  expect(await onCall({ id: 4, token: 'document-one', args })).toBe(false);
  expect(bridge.post).toHaveBeenCalledTimes(1);
});

test('relays reports and return values with the private token', async () => {
  await handlers.McpReport({ id: 1, callId: 'call', json: '0' }, PAGE);
  await handlers.McpReturn({ id: 2, callId: 'call', json: '1' }, CONTENT);
  expect(sendCmd).toHaveBeenCalledWith('McpReport', { id: 1, callId: 'call', json: '0', token: 'document-one' });
  expect(sendCmd).toHaveBeenCalledWith('McpReturn', { id: 2, callId: 'call', json: '1', token: 'document-one' });
});

test('restores registered handlers in both realms and gates reports/calls on the new token', async () => {
  await handlers.McpRegister({ id: 1, handlers: [sum, ping] }, PAGE);
  await handlers.McpRegister({ id: 2, handlers: [ping] }, CONTENT);
  await handlers.McpUnregister({ id: 1, names: ['ping'] }, PAGE);
  let resolveRestore;
  sendCmd.mockImplementation(cmd => cmd === 'McpRestoreDocument'
    ? new Promise(resolve => { resolveRestore = resolve; }) : Promise.resolve(true));
  sendCmd.mockClear();
  const restoring = restoreMcp();
  const report = handlers.McpReport({ id: 1, json: '0' }, PAGE);
  const call = onCall({ id: 2, token: 'restored', args });
  await Promise.resolve();
  expect(sendCmd).toHaveBeenCalledTimes(1);
  expect(sendCmd).toHaveBeenCalledWith('McpRestoreDocument', {
    ...context,
    scripts: [{ id: 1, handlers: [sum] }, { id: 2, handlers: [ping] }],
  });
  expect(bridge.post).not.toHaveBeenCalled();

  resolveRestore({ token: 'restored' });
  await Promise.all([restoring, report]);
  expect(await call).toBe(true);
  expect(sendCmd).toHaveBeenCalledWith('McpReport', { id: 1, json: '0', token: 'restored' });
  expect(bridge.post).toHaveBeenCalledWith('McpCall', { id: 2, args }, CONTENT);
  expect(await onCall({ id: 1, token: 'document-one', args })).toBe(false);
});

test('fully unregistered and report-only scripts are not restored as callable', async () => {
  await handlers.McpRegister({ id: 1, handlers: [ping] }, PAGE);
  await handlers.McpUnregister({ id: 1, names: ['ping'] }, PAGE);
  sendCmd.mockResolvedValue({ token: 'restored' });
  await restoreMcp();
  expect(sendCmd).toHaveBeenCalledWith('McpRestoreDocument', { ...context, scripts: [] });
  await handlers.McpReport({ id: 1, json: 'false' }, PAGE);
  expect(sendCmd).toHaveBeenLastCalledWith('McpReport', { id: 1, json: 'false', token: 'restored' });
});

test('does not recover failed registrations or restore a page that was never authorized', async () => {
  sendCmd.mockRejectedValueOnce(new Error('Script removed'));
  await expect(handlers.McpRegister({ id: 1, handlers: [sum] }, PAGE)).rejects.toThrow('Script removed');
  sendCmd.mockResolvedValue({ token: 'restored' });
  await restoreMcp();
  expect(sendCmd).toHaveBeenLastCalledWith('McpRestoreDocument', { ...context, scripts: [] });
  sendCmd.mockClear();
  setMcp(Promise.resolve({}));
  await restoreMcp();
  expect(sendCmd).not.toHaveBeenCalled();
});

test('failed restoration disables the old channel without an unhandled rejection', async () => {
  await handlers.McpRegister({ id: 1, handlers: [sum] }, PAGE);
  sendCmd.mockRejectedValue(new Error('MCP authorization changed'));
  await restoreMcp();
  sendCmd.mockClear();
  await expect(handlers.McpReport({ id: 1, json: '0' }, PAGE)).rejects.toThrow(/unavailable/);
  expect(await onCall({ id: 1, token: 'document-one', args })).toBe(false);
  await restoreMcp();
  expect(sendCmd).not.toHaveBeenCalled();
});

test('rejects ungranted documents and mismatched script realms', async () => {
  await expect(handlers.McpReport({ id: 1, json: '0' }, CONTENT)).rejects.toThrow(/unavailable/);
  setMcp(Promise.resolve({}));
  await expect(handlers.McpRegister({ id: 1, handlers: [sum] }, PAGE)).rejects.toThrow(/unavailable/);
  expect(sendCmd).not.toHaveBeenCalled();
});
