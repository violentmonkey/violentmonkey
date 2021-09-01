import test from 'tape';
import { buffer2string } from '#/common';
import { wrapGM } from '#/injected/web/gm-wrapper';
import bridge from '#/injected/web/bridge';

const stringAsBase64 = str => btoa(buffer2string(new TextEncoder().encode(str).buffer));

const blobAsText = async blobUrl => new Promise(resolve => {
  const fr = new FileReader();
  fr.onload = () => resolve(new TextDecoder().decode(fr.result));
  fr.readAsArrayBuffer(URL._cache[blobUrl]);
});

// WARNING: don't include D800-DFFF range which is for surrogate pairs
const RESOURCE_TEXT = 'abcd\u1234\u2345\u3456\u4567\u5678\u6789\u789A\u89AB\u9ABC\uABCD';
/** @type VMScript */
const script = {
  config: {},
  custom: {},
  props: {
    id: 1,
  },
  meta: {
    grant: [
      'GM_getResourceText',
      'GM_getResourceURL',
    ],
    resources: {
      foo: 'https://dummy.url/foo.txt',
    },
  },
};
const wrapper = wrapGM(script);
bridge.cache = {
  [script.meta.resources.foo]: `text/plain,${stringAsBase64(RESOURCE_TEXT)}`,
};

test('@resource decoding', async (t) => {
  t.equal(wrapper.GM_getResourceText('foo'), RESOURCE_TEXT, 'GM_getResourceText');
  t.equal(await blobAsText(wrapper.GM_getResourceURL('foo')), RESOURCE_TEXT, 'GM_getResourceURL');
  t.end();
});
