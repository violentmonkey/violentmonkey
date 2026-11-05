import { buffer2string, readBlob } from '@/common';
import { decodeResource } from '@/injected/content/util';

const stringAsBase64 = str => btoa(buffer2string(new TextEncoder().encode(str).buffer));

const blobAsText = async blob => new TextDecoder().decode(await readBlob(blob, true));
const blobAsBytes = async blob => [...new Uint8Array(await readBlob(blob, true))];

// WARNING: don't include D800-DFFF range which is for surrogate pairs
const RESOURCE_TEXT = 'abcd\u1234\u2345\u3456\u4567\u5678\u6789\u789A\u89AB\u9ABC\uABCD';
const DATA = `text/plain,${stringAsBase64(RESOURCE_TEXT)}`;
const DATA_URL = `data:${DATA.replace(',', ';base64,')}`;
const PLAIN_DATA_URL = `data:text/plain,${encodeURIComponent(RESOURCE_TEXT)}`;

test('@resource decoding', async () => {
  expect(decodeResource(DATA)).toEqual(RESOURCE_TEXT);
  expect(await blobAsText(URL.blobCache[decodeResource(DATA, true)])).toEqual(RESOURCE_TEXT);
  expect(decodeResource(DATA, false)).toEqual(DATA_URL);
});

test('@resource decoding of data urls', async () => {
  expect(decodeResource(DATA_URL)).toEqual(RESOURCE_TEXT);
  expect(await blobAsText(URL.blobCache[decodeResource(DATA_URL, true)])).toEqual(RESOURCE_TEXT);
  expect(decodeResource(DATA_URL, false)).toEqual(DATA_URL);
  expect(decodeResource(PLAIN_DATA_URL)).toEqual(RESOURCE_TEXT);
  expect(await blobAsText(URL.blobCache[decodeResource(PLAIN_DATA_URL, true)])).toEqual(RESOURCE_TEXT);
  expect(decodeResource(PLAIN_DATA_URL, false)).toEqual(PLAIN_DATA_URL);
  expect(decodeResource(PLAIN_DATA_URL, true)).toMatch(/^blob:/);
  expect(decodeResource('data:text/plain,hello%20world')).toEqual('hello world');
});

test('@resource decoding keeps bytes in non-base64 data urls', async () => {
  const plain = URL.blobCache[decodeResource('data:application/octet-stream,%FF%00', true)];
  expect(await blobAsBytes(plain)).toEqual([0xFF, 0]);
});

test('@resource decoding of an invalid data url', () => {
  expect(decodeResource('data:text/plain,invalid%ZZ%2')).toEqual('invalid%ZZ%2');
});
