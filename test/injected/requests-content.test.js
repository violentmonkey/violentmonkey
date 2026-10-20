import { runInThisContext } from 'node:vm';
import { ReadableStream, ReadableStreamDefaultController } from 'node:stream/web';
import * as webBridge from '@/injected/web/bridge';
import { onRequestCreate } from '@/injected/web/requests';
import initFetch from '@/background/utils/requests-fetch';

jest.mock('@/injected/content/bridge', () => {
  const handlers = {};
  const backgroundHandlers = {};
  return {
    handlers,
    backgroundHandlers,
    onScripts: [],
    addHandlers: obj => Object.assign(handlers, obj),
    addBackgroundHandlers: obj => Object.assign(backgroundHandlers, obj),
    post: jest.fn(),
  };
});
jest.mock('@/injected/content/util', () => ({
  ...jest.requireActual('@/injected/content/util'),
  sendCmd: jest.fn(async () => {}),
}));

const bridge = require('@/injected/content/bridge');
const { sendCmd } = require('@/injected/content/util');
require('@/injected/content/requests');

beforeAll(() => {
  Object.assign(global, runInThisContext('({ fetch, Response, AbortController })'), {
    SafeReadableStream: ReadableStream,
    streamEnqueue: ReadableStreamDefaultController.prototype.enqueue,
    streamClose: ReadableStreamDefaultController.prototype.close,
    streamError: ReadableStreamDefaultController.prototype.error,
  });
  bridge.onScripts.forEach(fn => fn({ info: { ua: {} } }));
});

beforeEach(() => {
  bridge.post.mockReset();
  global.fetch = runInThisContext('fetch');
});

test('decodes each streamed byte chunk across the content bridge without accumulating it', async () => {
  await bridge.handlers.HttpRequest({
    id: 'stream',
    data: [],
    url: 'https://example.com/',
    xhrType: '',
    responseType: 'stream',
  }, 'page');
  await bridge.backgroundHandlers.HttpRequested({
    id: 'stream',
    type: 'loadstart',
    stream: true,
    data: { response: null, status: 200 },
  });
  await bridge.backgroundHandlers.HttpRequested({
    id: 'stream',
    type: 'progress',
    stream: true,
    data: { response: 'AID/', loaded: 3 },
  });
  const [cmd, msg, realm] = bridge.post.mock.calls[1];
  expect(cmd).toBe('HttpRequested');
  expect(realm).toBe('page');
  expect(msg.data.response).toEqual(new Uint8Array([0, 128, 255]));
  await bridge.backgroundHandlers.HttpRequested({
    id: 'stream',
    type: 'load',
    stream: true,
    data: { response: null, status: 200 },
  });
  await bridge.backgroundHandlers.HttpRequested({
    id: 'stream',
    type: 'loadend',
    stream: true,
    data: null,
  });
  expect(bridge.post.mock.calls.map(([, data]) => data.type))
    .toEqual(['loadstart', 'progress', 'load', 'loadend']);
});

async function fetchThroughBridge(details) {
  let creation;
  webBridge.setPost((cmd, payload) => {
    if (cmd === 'HttpRequest') creation = bridge.handlers.HttpRequest(payload.data, 'page');
  });
  bridge.post.mockImplementation((cmd, data) => webBridge.onHandle({ cmd, data }));
  const promise = onRequestCreate(Object.assign(Object.create(null), {
    url: 'data:application/octet-stream;base64,AID/',
  }, details), { id: 1, async: true });
  await creation;
  const opts = sendCmd.mock.calls.filter(([cmd]) => cmd === 'HttpRequest').at(-1)[1];
  await initFetch(opts, { id: opts.id, cb: bridge.backgroundHandlers.HttpRequested },
    opts.events, opts.url, {}, undefined);
  return promise;
}

test('delivers a readable byte stream through the fetch, content and userscript layers', async () => {
  let startResponse;
  let firstRead;
  const result = await fetchThroughBridge({
    responseType: 'stream',
    onloadstart(data) {
      startResponse = data.response;
      firstRead = startResponse.getReader().read();
    },
  });
  expect(result.response).toBe(startResponse);
  expect(await firstRead).toEqual({ value: new Uint8Array([0, 128, 255]), done: false });
});

test('makes a fetch response available when readyState reaches DONE', async () => {
  let completed;
  const result = await fetchThroughBridge({
    fetch: true,
    url: 'data:text/plain,hello',
    onreadystatechange(data) {
      if (data.readyState === 4) completed = data.responseText;
    },
  });
  expect(completed).toBe('hello');
  expect(result.responseText).toBe('hello');
});

test('reconstructs fetch arraybuffers through extension messaging', async () => {
  const result = await fetchThroughBridge({ responseType: 'arraybuffer', fetch: true });
  expect(new Uint8Array(result.response)).toEqual(new Uint8Array([0, 128, 255]));
});

test.each(['stream', 'arraybuffer'])('preserves large offset byte views in legacy %s transport', async responseType => {
  const storage = new Uint8Array(2_014_000).fill(17);
  const bytes = storage.subarray(2000, 2_012_000);
  bytes.fill(34, 0, 1e6);
  bytes.fill(51, 1e6, 2e6);
  bytes.fill(68, 2e6);
  const expected = Buffer.from(bytes);
  const nativeBase64 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
  Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: undefined });
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }));
  try {
    const result = await fetchThroughBridge({ responseType, fetch: true });
    let received;
    if (responseType === 'stream') {
      const chunks = [];
      const reader = result.response.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      received = Buffer.concat(chunks);
    } else received = Buffer.from(result.response);
    expect(received.length).toBe(2_010_000);
    expect(Buffer.compare(received, expected)).toBe(0);
  } finally {
    if (nativeBase64) Object.defineProperty(Uint8Array.prototype, 'toBase64', nativeBase64);
    else delete Uint8Array.prototype.toBase64;
  }
});

test.each(['', 'json', 'arraybuffer'])('delivers the final %s response when only onloadend is subscribed', async responseType => {
  let creation;
  let completed;
  const url = responseType === 'json' ? 'data:application/json,%7B%22test%22%3A1%7D'
    : 'data:text/plain,hello';
  webBridge.setPost((cmd, payload) => {
    if (cmd === 'HttpRequest') creation = bridge.handlers.HttpRequest(payload.data, 'page');
  });
  bridge.post.mockImplementation((cmd, data) => webBridge.onHandle({ cmd, data }));
  onRequestCreate(Object.assign(Object.create(null), {
    url,
    responseType,
    fetch: true,
    onloadend(data) { completed = data; },
  }), { id: 1 });
  await creation;
  const opts = sendCmd.mock.calls.filter(([cmd]) => cmd === 'HttpRequest').at(-1)[1];
  await initFetch(opts, { id: opts.id, cb: bridge.backgroundHandlers.HttpRequested },
    opts.events, url, {}, undefined);
  if (responseType === 'arraybuffer') {
    expect(new Uint8Array(completed.response)).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  } else expect(completed.response).toEqual(responseType === 'json' ? { test: 1 } : 'hello');
});
