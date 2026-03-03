import { sendCmdDirectly, sendMessageRetry } from '@/common';

const runtime = global.browser.runtime;
const extension = global.browser.extension;
const storageLocal = global.browser.storage.local;
const { extensionManifest } = global;

let sendMessage;
let getBackgroundPage;
let manifestVersion;
let storageGet;

beforeEach(() => {
  sendMessage = runtime.sendMessage;
  getBackgroundPage = extension.getBackgroundPage;
  manifestVersion = extensionManifest.manifest_version;
  storageGet = storageLocal.get;
});

afterEach(() => {
  runtime.sendMessage = sendMessage;
  extension.getBackgroundPage = getBackgroundPage;
  extensionManifest.manifest_version = manifestVersion;
  storageLocal.get = storageGet;
});

test('sendCmdDirectly falls back to runtime messaging when no bg page exists', async () => {
  extension.getBackgroundPage = undefined;
  runtime.sendMessage = jest.fn(async payload => payload);
  const data = { id: 1, nested: { ok: true } };
  const res = await sendCmdDirectly('GetData', data);
  expect(runtime.sendMessage).toHaveBeenCalledWith({ cmd: 'GetData', data });
  expect(res).toEqual({ cmd: 'GetData', data });
});

test('sendCmdDirectly uses direct bg handler when available', async () => {
  runtime.sendMessage = jest.fn(async () => ({ via: 'runtime' }));
  const bg = {
    deepCopy: val => JSON.parse(JSON.stringify(val)),
    handleCommandMessage: jest.fn(async payload => ({ ...payload, via: 'bg' })),
  };
  extension.getBackgroundPage = () => bg;
  const data = { id: 2, nested: { ok: true } };
  const res = await sendCmdDirectly('GetData', data);
  expect(bg.handleCommandMessage).toHaveBeenCalledWith({ cmd: 'GetData', data }, undefined);
  expect(runtime.sendMessage).not.toHaveBeenCalled();
  expect(res).toEqual({ cmd: 'GetData', data, via: 'bg' });
});

test('sendCmdDirectly skips bg direct calls in MV3 mode', async () => {
  extensionManifest.manifest_version = 3;
  runtime.sendMessage = jest.fn(async payload => ({ ...payload, via: 'runtime' }));
  const bg = {
    deepCopy: val => JSON.parse(JSON.stringify(val)),
    handleCommandMessage: jest.fn(async payload => ({ ...payload, via: 'bg' })),
  };
  extension.getBackgroundPage = () => bg;
  const data = { id: 3 };
  const res = await sendCmdDirectly('GetData', data);
  expect(bg.handleCommandMessage).not.toHaveBeenCalled();
  expect(runtime.sendMessage).toHaveBeenCalledWith({ cmd: 'GetData', data });
  expect(res).toEqual({ cmd: 'GetData', data, via: 'runtime' });
});

test('sendCmdDirectly routes src-sensitive commands through runtime messaging', async () => {
  runtime.sendMessage = jest.fn(async payload => ({ ...payload, via: 'runtime' }));
  const bg = {
    deepCopy: val => JSON.parse(JSON.stringify(val)),
    handleCommandMessage: jest.fn(async payload => ({ ...payload, via: 'bg' })),
  };
  extension.getBackgroundPage = () => bg;
  const data = { id: 9 };
  const res = await sendCmdDirectly('ConfirmInstall', data);
  expect(bg.handleCommandMessage).not.toHaveBeenCalled();
  expect(runtime.sendMessage).toHaveBeenCalledWith({ cmd: 'ConfirmInstall', data });
  expect(res).toEqual({ cmd: 'ConfirmInstall', data, via: 'runtime' });
});

test('sendMessageRetry retries on transient port-closed errors', async () => {
  runtime.sendMessage = jest.fn()
    .mockRejectedValueOnce(new Error('The message port closed before a response was received.'))
    .mockResolvedValueOnce({ ok: true });
  storageLocal.get = jest.fn(async () => ({}));
  const res = await sendMessageRetry({ cmd: 'Ping' }, 1000);
  expect(res).toEqual({ ok: true });
  expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  expect(storageLocal.get).toHaveBeenCalled();
});

test('sendMessageRetry retries on transient channel-closed errors with object payloads', async () => {
  runtime.sendMessage = jest.fn()
    .mockRejectedValueOnce({
      message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received.',
    })
    .mockResolvedValueOnce({ ok: true });
  storageLocal.get = jest.fn(async () => ({}));
  const res = await sendMessageRetry({ cmd: 'Ping' }, 1000);
  expect(res).toEqual({ ok: true });
  expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  expect(storageLocal.get).toHaveBeenCalled();
});

test('sendMessageRetry throws immediately on non-port errors', async () => {
  runtime.sendMessage = jest.fn()
    .mockRejectedValueOnce(new Error('permission denied'));
  await expect(sendMessageRetry({ cmd: 'Ping' }, 1000)).rejects.toThrow('permission denied');
  expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
});
