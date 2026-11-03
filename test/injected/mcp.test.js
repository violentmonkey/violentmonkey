import * as bridge from '@/injected/web/bridge';
import { makeMcpApi } from '@/injected/web/mcp';
import { MCP_RESULT_MAX } from '@/common/consts';

jest.mock('@/injected/web/bridge', () => ({
  addHandlers: jest.fn(),
  promise: jest.fn(),
}));

const onCall = bridge.addHandlers.mock.calls[0][0].McpCall;
const mcp = makeMcpApi({ id: 1 });
const call = (handler, params = null, callId = 'call') => onCall({ id: 1, args: { callId, handler, params } });
const sent = cmd => bridge.promise.mock.calls.filter(c => c[0] === cmd).map(c => c[1]);

beforeEach(() => {
  bridge.promise.mockReset().mockResolvedValue(true);
});

test('registers named handlers with descriptions and serialized schemas', async () => {
  const inputSchema = { type: 'object', properties: { a: { type: 'number' } } };
  await mcp.register({
    sum: { description: 'Adds numbers', inputSchema, handle: () => 0 },
    ping: { handle: () => 'pong' },
  });
  expect(bridge.promise).toHaveBeenCalledWith('McpRegister', {
    id: 1,
    handlers: [
      { name: 'sum', description: 'Adds numbers', schema: JSON.stringify(inputSchema) },
      { name: 'ping', description: undefined, schema: undefined },
    ],
  });
});

test.each([
  [null, /object of named handlers/],
  [{}, /at least one handler/],
  [{ sum: {} }, /handle function/],
  [{ sum: { handle() {}, description: 1 } }, /description/],
  [{ sum: { handle() {}, inputSchema: { big: 1n } } }, /BigInt/],
])('rejects invalid definitions %p without contacting the host', async (defs, error) => {
  await expect(mcp.register(defs)).rejects.toThrow(error);
  expect(bridge.promise).not.toHaveBeenCalled();
});

test('settles a call with the async return value of the named handler', async () => {
  const handle = jest.fn(async function ({ params }) { return this.add(params.a, params.b); });
  await mcp.register({ sum: { add: (a, b) => a + b, handle } });
  await call('sum', { a: 2, b: 3 }, 'one');
  expect(handle.mock.calls[0][0]).toMatchObject({ params: { a: 2, b: 3 }, report: expect.any(Function) });
  expect(handle.mock.calls[0][0]).not.toHaveProperty('callId');
  expect(sent('McpReturn')).toEqual([{ id: 1, callId: 'one', json: '5', error: undefined }]);
});

test.each([false, 0, '', null, undefined])('preserves synchronous value %s', async value => {
  await mcp.register({ get: { handle: () => value } });
  await call('get');
  expect(sent('McpReturn')[0].json).toBe(JSON.stringify(value ?? null));
});

test.each([
  () => { throw new Error('sync failed'); },
  async () => { throw new Error('async failed'); },
  () => 1n,
  () => { const circular = {}; circular.self = circular; return circular; },
  () => 'x'.repeat(MCP_RESULT_MAX),
])('turns thrown/rejected/unserializable results into failed calls', async handle => {
  await mcp.register({ bad: { handle } });
  await call('bad', null, 'failed');
  expect(sent('McpReturn').at(-1)).toMatchObject({ id: 1, callId: 'failed', json: 'null', error: expect.any(String) });
});

test('a missing handler fails the call', async () => {
  await call('nope');
  expect(sent('McpReturn')[0]).toMatchObject({ error: 'MCP handler "nope" is no longer registered' });
});

test('the bound report attaches results to its call, also after the call settles', async () => {
  let report;
  await mcp.register({ job: { handle: ctx => { ({ report } = ctx); return 'started'; } } });
  await call('job', null, 'job-1');
  await report({ progress: 1 });
  await report(null, { error: 'later failure' });
  expect(sent('McpReport')).toEqual([
    { id: 1, callId: 'job-1', json: '{"progress":1}', error: undefined },
    { id: 1, callId: 'job-1', json: 'null', error: 'later failure' },
  ]);
});

test('GM.mcp.report sends unsolicited results and rejects host errors', async () => {
  await expect(mcp.report({ result: 3 })).resolves.toBeUndefined();
  expect(sent('McpReport')).toEqual([{ id: 1, callId: undefined, json: '{"result":3}', error: undefined }]);
  bridge.promise.mockRejectedValue(new Error('Not authorized'));
  await expect(mcp.report(2)).rejects.toThrow('Not authorized');
  await expect(mcp.report(1n)).rejects.toThrow();
});

test('re-registering a name replaces it, unregister removes only its own handlers', async () => {
  const first = await mcp.register({ a: { handle: () => 'a1' }, b: { handle: () => 'b1' } });
  await mcp.register({ a: { handle: () => 'a2' } });
  await first();
  expect(sent('McpUnregister')).toEqual([{ id: 1, names: ['b'] }]);
  await call('a');
  await call('b');
  expect(sent('McpReturn').map(r => r.json)).toEqual(['"a2"', 'null']);
  await first();
  expect(sent('McpUnregister')).toHaveLength(1);
});

test('a rejected registration restores the previous handler', async () => {
  await mcp.register({ a: { handle: () => 'old' } });
  bridge.promise.mockRejectedValueOnce(new Error('Too many handlers'));
  await expect(mcp.register({ a: { handle: () => 'new' }, b: { handle: () => 'b' } }))
  .rejects.toThrow('Too many handlers');
  await call('a');
  await call('b');
  expect(sent('McpReturn').map(r => r.json)).toEqual(['"old"', 'null']);
});
