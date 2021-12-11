import test from 'tape';
import { buffer2string } from '#/common';
import { decodeResource } from '#/injected/content/util-content';

const stringAsBase64 = str => btoa(buffer2string(new TextEncoder().encode(str).buffer));

const blobAsText = async blob => new Promise(resolve => {
  const fr = new FileReader();
  fr.onload = () => resolve(new TextDecoder().decode(fr.result));
  fr.readAsArrayBuffer(blob);
});

// WARNING: don't include D800-DFFF range which is for surrogate pairs
const RESOURCE_TEXT = 'abcd\u1234\u2345\u3456\u4567\u5678\u6789\u789A\u89AB\u9ABC\uABCD';
const DATA = `text/plain,${stringAsBase64(RESOURCE_TEXT)}`;
const DATA_URL = `data:${DATA.replace(',', ';base64,')}`;

test('@resource decoding', async (t) => {
  t.equal(decodeResource(DATA), RESOURCE_TEXT, 'GM_getResourceText');
  t.equal(await blobAsText(decodeResource(DATA, true)), RESOURCE_TEXT, 'GM_getResourceURL');
  t.equal(decodeResource(DATA, false), DATA_URL, 'GM_getResourceURL as dataUrl');
  t.end();
});
