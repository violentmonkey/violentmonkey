import {
  addReport, beginCall, clearExecution, dropExecutionTab, ENTRIES_MAX, failCall, getHandlers,
  getResults, HANDLERS_MAX, registerHandlers, restoreDocument, settleCall, startDocument,
  unregisterHandlers,
} from '@/background/utils/mcp-execution';
import { MCP_RESULT_MAX } from '@/common/consts';

const TAB = 7;
const sum = { name: 'sum', description: 'Adds numbers', schema: '{"type":"object"}' };
const ping = { name: 'ping' };
const sumInfo = { name: 'sum', description: 'Adds numbers', inputSchema: { type: 'object' } };
let mcp;
let token;
beforeEach(() => {
  jest.useFakeTimers();
  mcp = startDocument(TAB, 0);
  ({ token } = mcp);
  registerHandlers(TAB, 0, token, 1, [sum]);
});
afterEach(() => {
  clearExecution();
  jest.useRealTimers();
});

const start = (opts = {}) => beginCall(TAB, { scriptId: 1, handler: 'sum', ...opts });
const settle = (call, value, extra = {}) => settleCall(TAB, 0, token, {
  id: 1, callId: call.result.callId, json: JSON.stringify(value), ...extra,
});
const report = (value, extra = {}) => addReport(TAB, 0, token, { id: 1, json: JSON.stringify(value), ...extra });
const handlerList = () => getHandlers(TAB).scripts;

test('lists named handlers with metadata per script and frame', () => {
  registerHandlers(TAB, 0, token, 1, [ping]);
  const sub = startDocument(TAB, 2).token;
  registerHandlers(TAB, 2, sub, 3, [ping]);
  expect(handlerList()).toEqual([
    { scriptId: 1, frameId: 0, handlers: [sumInfo, { name: 'ping' }] },
    { scriptId: 3, frameId: 2, handlers: [{ name: 'ping' }] },
  ]);
  handlerList()[0].handlers[0].name = 'mutated';
  expect(handlerList()[0].handlers[0].name).toBe('sum');
});

test('re-registering replaces by name and unregistering removes only the given names', () => {
  registerHandlers(TAB, 0, token, 1, [{ name: 'sum' }, ping]);
  expect(handlerList()[0].handlers).toEqual([{ name: 'sum' }, { name: 'ping' }]);
  unregisterHandlers(TAB, 0, token, 1, ['sum', 'unknown']);
  expect(handlerList()[0].handlers).toEqual([{ name: 'ping' }]);
  unregisterHandlers(TAB, 0, token, 1, ['ping']);
  expect(handlerList()).toEqual([]);
});

test.each([
  [[], /1–32/],
  [[{ name: 'bad name' }], /names must be/],
  [[{ name: 'x'.repeat(65) }], /names must be/],
  [[{ name: 'a', description: 'x'.repeat(1025) }], /Description/],
  [[{ name: 'a', schema: 'x'.repeat(16 * 1024 + 1) }], /exceeds/],
  [[{ name: 'a', schema: '[1]' }], /JSON object/],
  [[{ name: 'a', schema: 'nope' }], /JSON object/],
])('rejects invalid handler metadata %#', (list, error) => {
  expect(() => registerHandlers(TAB, 0, token, 1, list)).toThrow(error);
  expect(handlerList()[0].handlers).toEqual([sumInfo]);
});

test('limits handlers per script across registrations', () => {
  const names = n => Array.from({ length: n }, (_, i) => ({ name: `h${i}` }));
  registerHandlers(TAB, 0, token, 2, names(HANDLERS_MAX));
  expect(() => registerHandlers(TAB, 0, token, 2, [{ name: 'extra' }])).toThrow(/at most/);
});

test('correlates concurrent calls and preserves falsy/structured values', async () => {
  const calls = [false, 0, '', null, { count: 2, rows: [1, 2] }].map(value => ({ value, call: start() }));
  for (const { value, call } of calls.reverse()) settle(call, value);
  for (const { value, call } of calls) {
    expect(await call.promise).toMatchObject({
      kind: 'call', status: 'completed', handler: 'sum', value, callId: call.result.callId,
    });
  }
  expect(getResults(TAB).entries).toHaveLength(calls.length);
});

test('dispatch message carries the private token while results show a public document id', () => {
  const call = start({ params: { a: 1 } });
  expect(call.message).toEqual({
    id: 1, token, args: { callId: call.result.callId, handler: 'sum', params: { a: 1 } },
  });
  expect(call.result.documentId).toEqual(expect.any(String));
  expect(call.result.documentId).not.toBe(token);
  expect(JSON.stringify(getResults(TAB))).not.toContain(token);
});

test('deduplicates retained call ids and ignores repeated return values', async () => {
  const args = { callId: 'request-1', params: { a: 1 } };
  const call = start(args);
  expect(start(args).isNew).toBe(false);
  expect(() => start({ ...args, params: 2 })).toThrow(/different call/);
  registerHandlers(TAB, 0, token, 1, [ping]);
  expect(() => start({ ...args, handler: 'ping' })).toThrow(/different call/);
  expect(settle(call, 42).accepted).toBe(true);
  expect(settle(call, 43).accepted).toBe(false);
  expect(await start(args).promise).toMatchObject({ value: 42 });
});

test('times out without pretending to stop the script and accepts a late return value', async () => {
  const call = start({ callId: 'slow', timeoutMs: 20 });
  jest.advanceTimersByTime(20);
  const result = await call.promise;
  expect(result.status).toBe('timed_out');
  settle(call, 'late');
  expect(getResults(TAB, { afterSeq: result.seq }).entries[0])
  .toMatchObject({ status: 'completed', value: 'late' });
  expect(result).not.toHaveProperty('value');
  expect(await start({ callId: 'slow' }).promise).toMatchObject({ status: 'completed', value: 'late' });
});

test('reports attach to their call before and after it settles without changing it', async () => {
  const call = start({ callId: 'job' });
  report({ progress: 1 }, { callId: 'job' });
  settle(call, 'done');
  report(null, { callId: 'job', error: 'cleanup failed' });
  expect(await call.promise).toMatchObject({ status: 'completed', value: 'done' });
  const { entries } = getResults(TAB, { callId: 'job' });
  expect(entries.map(e => [e.kind, e.value ?? e.error])).toEqual([
    ['report', { progress: 1 }], ['call', 'done'], ['report', 'cleanup failed'],
  ]);
  expect(entries[0]).toMatchObject({ scriptId: 1, frameId: 0, reportedAt: expect.any(Number) });
});

test('reporting keeps the call retained', () => {
  settle(start({ callId: 'job' }), 1);
  jest.advanceTimersByTime(4 * 60 * 1000);
  report(2, { callId: 'job' });
  jest.advanceTimersByTime(2 * 60 * 1000);
  expect(getResults(TAB, { callId: 'job' }).entries.map(e => e.kind)).toEqual(['call', 'report']);
  jest.advanceTimersByTime(4 * 60 * 1000);
  expect(getResults(TAB).entries).toEqual([]);
});

test('reports of an evicted call are not attributed to a new call with the same id', () => {
  // Large params let the size limit evict the call alone, leaving its small report.
  settle(start({ callId: 'job', params: 'x'.repeat(200 * 1024) }), 1);
  report(2, { callId: 'job' });
  for (let i = 0; i < 4; i += 1) report('y'.repeat(240 * 1024));
  expect(getResults(TAB, { callId: 'job' }).entries.map(e => e.kind)).toEqual(['report']);
  start({ callId: 'job' });
  report(5, { callId: 'job' });
  expect(getResults(TAB, { callId: 'job' }).entries.map(e => e.value ?? e.status)).toEqual(['pending', 5]);
});

test('stale reports fail when their call is not retained', () => {
  const removed = getResults(TAB).dropped;
  expect(() => report(1, { callId: 'missing' })).toThrow(/matching call/);
  expect(getResults(TAB).dropped).toBe(removed);
});

test('returns errors and delivery failures as structured results', async () => {
  const failed = start();
  settle(failed, null, { error: 'Script rejected' });
  expect(await failed.promise).toMatchObject({ status: 'failed', error: 'Script rejected' });
  const missing = start();
  failCall(TAB, missing.result.callId, 'No receiver');
  expect(await missing.promise).toMatchObject({ status: 'failed', error: 'No receiver' });
});

test('isolates tabs, scripts, frames and documents', () => {
  const call = start();
  expect(() => settle(call, 1, { id: 2 })).toThrow(/matching call/);
  const sub = startDocument(TAB, 2).token;
  registerHandlers(TAB, 2, sub, 1, [sum]);
  const answer = { id: 1, callId: call.result.callId, json: '1' };
  expect(() => settleCall(TAB, 2, sub, answer)).toThrow(/matching call/);
  expect(() => addReport(TAB, 2, sub, answer)).toThrow(/matching call/);
  const other = startDocument(8, 0).token;
  expect(() => settleCall(8, 0, other, answer)).toThrow(/matching call/);
  expect(() => registerHandlers(TAB, 0, 'stale-token', 1, [sum])).toThrow(/different document/);
  expect(handlerList().map(s => s.frameId)).toEqual([0, 2]);
});

test('navigation cancels waiters and rejects replies from the previous document', async () => {
  const call = start();
  startDocument(TAB, 0);
  expect(await call.promise).toMatchObject({ status: 'cancelled' });
  expect(() => settle(call, 'stale')).toThrow(/different document/);
  expect(() => report('stale', { callId: call.result.callId })).toThrow(/different document/);
  expect(handlerList()).toEqual([]);
});

test('subframe reload only cancels that frame', async () => {
  const main = start();
  registerHandlers(TAB, 2, startDocument(TAB, 2).token, 1, [sum]);
  const sub = start({ frameId: 2 });
  startDocument(TAB, 2);
  expect(await sub.promise).toMatchObject({ status: 'cancelled' });
  settle(main, 'ok');
  expect(await main.promise).toMatchObject({ status: 'completed' });
});

test('back/forward restoration renews calls and reports without reviving old results', async () => {
  const contextA = mcp;
  const oldCall = start();
  const docB = startDocument(TAB, 0);
  registerHandlers(TAB, 0, docB.token, 2, [ping]);
  const callB = beginCall(TAB, { scriptId: 2, handler: 'ping' });

  const restoredA = restoreDocument(TAB, 0, { ...contextA, scripts: [{ id: 1, handlers: [sum] }] });
  expect(restoredA).not.toBe(token);
  expect(handlerList()).toEqual([{ scriptId: 1, frameId: 0, handlers: [sumInfo] }]);
  expect(await oldCall.promise).toMatchObject({ status: 'cancelled' });
  expect(await callB.promise).toMatchObject({ status: 'cancelled' });
  expect(() => settle(oldCall, 'stale')).toThrow(/different document/);
  const late = { id: 1, callId: oldCall.result.callId, json: '0' };
  expect(() => settleCall(TAB, 0, restoredA, late)).toThrow(/matching call/);
  expect(() => addReport(TAB, 0, restoredA, late)).toThrow(/matching call/);
  expect(() => addReport(TAB, 0, docB.token, { id: 2, json: '0' })).toThrow(/different document/);

  const call = start();
  settleCall(TAB, 0, restoredA, { id: 1, callId: call.result.callId, json: '42' });
  expect(await call.promise).toMatchObject({ status: 'completed', value: 42 });
  expect(addReport(TAB, 0, restoredA, { id: 1, json: 'false' })).toBe(true);

  const restoredB = restoreDocument(TAB, 0, { ...docB, scripts: [{ id: 2, handlers: [ping] }] });
  expect(handlerList()).toEqual([{ scriptId: 2, frameId: 0, handlers: [{ name: 'ping' }] }]);
  expect(() => addReport(TAB, 0, restoredA, { id: 1, json: '0' })).toThrow(/different document/);
  expect(addReport(TAB, 0, restoredB, { id: 2, json: 'true' })).toBe(true);
});

test.each([[0, 2], [2, 0]])('restores parent/child frames in pageshow order %p', (first, second) => {
  const context = startDocument(TAB, 2);
  startDocument(TAB, 0);
  startDocument(TAB, 3);
  const scripts = [{ id: 1, handlers: [sum] }];
  restoreDocument(TAB, first, { ...context, scripts });
  restoreDocument(TAB, second, { ...context, scripts });
  expect(handlerList().map(s => s.frameId)).toEqual([first, second]);
});

test('subframe-only restoration preserves the main frame and its pending calls', async () => {
  const context = startDocument(TAB, 2);
  const main = start();
  startDocument(TAB, 2);
  restoreDocument(TAB, 2, { ...context, scripts: [{ id: 2, handlers: [ping] }] });
  expect(handlerList().map(s => [s.scriptId, s.frameId])).toEqual([[1, 0], [2, 2]]);
  settle(main, 'still active');
  expect(await main.promise).toMatchObject({ status: 'completed', value: 'still active' });
});

test('restoration validates scripts and handlers', () => {
  startDocument(TAB, 0);
  expect(() => restoreDocument(TAB, 0, { ...mcp, scripts: [{ id: 0, handlers: [sum] }] })).toThrow(/Invalid restored/);
  expect(() => restoreDocument(TAB, 0, { ...mcp, scripts: [{ id: 1, handlers: [{ name: '' }] }] })).toThrow(/names must be/);
});

test('restoration cannot recreate a revoked session even after reauthorization', () => {
  const scripts = [{ id: 1, handlers: [sum] }];
  dropExecutionTab(TAB);
  expect(() => restoreDocument(TAB, 0, { ...mcp, scripts })).toThrow(/authorization changed/);
  startDocument(TAB, 0);
  expect(() => restoreDocument(TAB, 0, { ...mcp, scripts })).toThrow(/authorization changed/);
  expect(handlerList()).toEqual([]);
});

test('revocation/tab close clears results, handlers and pending timers', async () => {
  const call = start();
  dropExecutionTab(TAB);
  expect(await call.promise).toMatchObject({ status: 'cancelled' });
  expect(getResults(TAB).entries).toEqual([]);
  expect(handlerList()).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
  expect(() => settle(call, 1)).toThrow(/different document/);
});

test('stores unsolicited reports and supports non-destructive filtered pagination', () => {
  for (let i = 0; i < 3; i += 1) report(i);
  addReport(TAB, 0, token, { id: 2, json: 'false' });
  const first = getResults(TAB, { scriptId: 1, limit: 2 });
  expect(first.entries.map(e => e.value)).toEqual([0, 1]);
  expect(first.entries[0]).not.toHaveProperty('callId');
  expect(getResults(TAB, { scriptId: 1, afterSeq: first.nextSeq }).entries.map(e => e.value)).toEqual([2]);
});

test('caps results and expires old terminal entries', () => {
  for (let i = 0; i < ENTRIES_MAX + 2; i += 1) report(i);
  expect(getResults(TAB, { limit: ENTRIES_MAX }).entries).toHaveLength(ENTRIES_MAX);
  expect(getResults(TAB).dropped).toBe(2);
  jest.advanceTimersByTime(5 * 60 * 1000 + 1);
  expect(getResults(TAB).entries).toEqual([]);
});

test('rejects missing handlers, oversized results and invalid options', () => {
  expect(() => start({ scriptId: 2 })).toThrow(/no MCP handler "sum"/);
  expect(() => start({ handler: 'ping' })).toThrow(/no MCP handler "ping"/);
  expect(() => start({ handler: undefined })).toThrow(/handler is required/);
  expect(() => start({ timeoutMs: 30000 })).toThrow(/Invalid call/);
  expect(() => start({ params: 'x'.repeat(MCP_RESULT_MAX) })).toThrow(/size limit/);
  expect(() => report('x'.repeat(MCP_RESULT_MAX))).toThrow(/Invalid script result/);
  expect(() => addReport(TAB, 0, token, { id: 1, json: 'not-json' })).toThrow(/must be JSON/);
  expect(() => getResults(TAB, { limit: -1 })).toThrow(/Invalid results/);
});
