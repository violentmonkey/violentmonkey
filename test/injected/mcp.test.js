import * as bridge from '@/injected/web/bridge';
import { registerMcpHandler, reportResult } from '@/injected/web/mcp';
import { MCP_RESULT_MAX } from '@/common/consts';

jest.mock('@/injected/web/bridge', () => ({
  addHandlers: jest.fn(),
  call: jest.fn(),
}));

const onCall = bridge.addHandlers.mock.calls[0][0].McpCall;
beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation((cmd, data, node, cb) => cb({ accepted: true, callId: data.callId }));
});

test('reports async callback return values with the original call id', async () => {
  const handler = jest.fn(async (params, ctx) => ({ sum: params.a + params.b, callId: ctx.callId }));
  await registerMcpHandler.call({ id: 1 }, handler);
  await onCall({ id: 1, callId: 'one', params: { a: 2, b: 3 } });
  expect(bridge.call).toHaveBeenLastCalledWith('ScriptResult', {
    id: 1, callId: 'one', json: '{"sum":5,"callId":"one"}', error: undefined,
  }, null, expect.any(Function));
});

test.each([false, 0, '', null, undefined])('preserves synchronous value %s', async value => {
  await registerMcpHandler.call({ id: 1 }, () => value);
  await onCall({ id: 1, callId: 'sync', params: null });
  expect(bridge.call.mock.calls.at(-1)[1].json).toBe(JSON.stringify(value ?? null));
});

test.each([
  () => { throw new Error('sync failed'); },
  async () => { throw new Error('async failed'); },
  () => 1n,
  () => { const circular = {}; circular.self = circular; return circular; },
  () => 'x'.repeat(MCP_RESULT_MAX),
])('turns thrown/rejected/unserializable results into failure reports', async handler => {
  await registerMcpHandler.call({ id: 1 }, handler);
  await onCall({ id: 1, callId: 'failed', params: null });
  expect(bridge.call.mock.calls.at(-1)[1]).toMatchObject({ id: 1, callId: 'failed', json: 'null', error: expect.any(String) });
});

test('explicit reports return acknowledgements and reject bridge failures', async () => {
  expect(await reportResult.call({ id: 1 }, { result: 3 }, { callId: 'manual' }))
  .toEqual({ accepted: true, callId: 'manual' });
  bridge.call.mockImplementation((cmd, data, node, cb) => cb(null, 'Not authorized'));
  await expect(reportResult.call({ id: 1 }, 2)).rejects.toThrow('Not authorized');
  await expect(registerMcpHandler.call({ id: 1 }, () => 2)).rejects.toThrow('Not authorized');
});
