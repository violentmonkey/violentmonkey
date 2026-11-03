import * as bridge from '@/injected/web/bridge';
import '@/injected/web/index';

let posted;
beforeEach(() => {
  posted = [];
  bridge.setPost((cmd, data) => posted.push(data));
});
const reply = (res, err) => bridge.onHandle({ cmd: 'Callback', data: { id: posted.at(-1).__CBID, res, err } });

test('bridge.promise resolves results and rejects host errors', async () => {
  const ok = bridge.promise('Cmd', 1);
  reply(42);
  await expect(ok).resolves.toBe(42);
  const failed = bridge.promise('Cmd', 2);
  reply(null, new Error('host failed'));
  await expect(failed).rejects.toThrow('host failed');
});

test('callbacks still receive errors with the caller stack', () => {
  const cb = jest.fn();
  bridge.call('Cmd', 3, null, cb, true);
  reply(null, new Error('async failed'));
  expect(cb).toHaveBeenCalledWith(null, expect.any(Error));
  expect(cb.mock.calls[0][1].stack).toContain('-----------');
});
