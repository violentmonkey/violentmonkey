import { ReadableStream, ReadableStreamDefaultController } from 'node:stream/web';
import * as bridge from '@/injected/web/bridge';
import { onRequestCreate } from '@/injected/web/requests';

let sent;

beforeAll(() => {
  Object.assign(global, {
    SafeReadableStream: ReadableStream,
    streamEnqueue: ReadableStreamDefaultController.prototype.enqueue,
    streamClose: ReadableStreamDefaultController.prototype.close,
    streamError: ReadableStreamDefaultController.prototype.error,
  });
});

beforeEach(() => {
  bridge.setPost((cmd, data) => {
    if (cmd === 'HttpRequest') sent = data.data;
  });
});

function createRequest(opts, async = false) {
  return onRequestCreate(Object.assign(Object.create(null), {
    url: 'https://example.com/data',
  }, opts), { id: 1, async });
}

function notify(type, data = {}, extra = {}) {
  bridge.onHandle({
 cmd: 'HttpRequested', data: {
    id: sent.id,
    type,
    data: { status: 200, readyState: 4, response: null, ...data },
    ...extra,
  }
});
}

test('preserves stream response type and the request transport options', () => {
  createRequest({
    responseType: 'stream',
    fetch: true,
    redirect: 'manual',
    cookie: 'session=custom',
    cookiePartition: { topLevelSite: 'https://example.org' },
    nocache: true,
    revalidate: true,
  });
  expect(sent).toMatchObject({
    responseType: 'stream',
    fetch: true,
    redirect: 'manual',
    cookie: 'session=custom',
    cookiePartition: { topLevelSite: 'https://example.org' },
    nocache: true,
    revalidate: true,
  });
});

test('exposes one readable byte stream from loadstart through completion', async () => {
  const starts = [];
  const loads = [];
  createRequest({
    responseType: 'stream',
    context: { test: true },
    onloadstart: data => starts.push(data),
    onload: data => loads.push(data),
  });
  notify('loadstart', { readyState: 2 }, { stream: true });
  expect(starts[0].response).toBeInstanceOf(ReadableStream);
  expect(starts[0].context).toEqual({ test: true });
  const reader = starts[0].response.getReader();
  notify('progress', { response: new Uint8Array([0, 128, 255]) }, { stream: true });
  expect(await reader.read()).toEqual({ value: new Uint8Array([0, 128, 255]), done: false });
  notify('load', {}, { stream: true });
  notify('loadend', {}, { stream: true });
  expect(await reader.read()).toEqual({ value: undefined, done: true });
  expect(loads[0].response).toBe(starts[0].response);
  expect(loads[0].responseText).toBeNull();
});

test.each(['abort', 'timeout', 'error'])('errors the stream after %s', async type => {
  let response;
  createRequest({ responseType: 'stream', onloadstart: data => { response = data.response; } });
  notify('loadstart', {}, { stream: true });
  expect(response).toBeInstanceOf(ReadableStream);
  const read = response.getReader().read();
  notify(type, {}, { stream: true, streamError: ['Stopped', 'AbortError'] });
  await expect(read).rejects.toMatchObject({ message: 'Stopped', name: 'AbortError' });
  notify('loadend', {}, { stream: true });
});

test('cancelling the readable stream aborts the transport', async () => {
  let response;
  const commands = [];
  createRequest({ responseType: 'stream', onloadstart: data => { response = data.response; } });
  const id = sent.id;
  bridge.setPost((...args) => commands.push(args));
  notify('loadstart', {}, { stream: true });
  expect(response).toBeInstanceOf(ReadableStream);
  await response.cancel();
  expect(commands).toEqual([['AbortRequest', id]]);
  notify('abort', {}, { stream: true });
  notify('loadend', {}, { stream: true });
});

test.each(['abort', 'timeout'])('rejects the GM.xmlHttpRequest promise on %s', async type => {
  let rejection;
  const request = createRequest({}, true);
  request.catch(err => { rejection = err; });
  notify(type, { status: 0 });
  await Promise.resolve();
  expect(rejection).toMatchObject({ status: 0, readyState: 4 });
  notify('loadend');
});
