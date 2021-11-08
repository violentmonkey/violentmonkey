import test from 'tape';
import { jsonDump } from '#/injected/web/util-web';

test('jsonDump', (t) => {
  const sameChildObj = { foo: 1 };
  // eslint-disable-next-line no-restricted-syntax
  for (const obj of [
    1,
    null,
    false,
    undefined,
    Infinity,
    NaN,
    'abc',
    {},
    [],
    [1, 2, 3, undefined, , 4], // eslint-disable-line no-sparse-arrays
    {
      a: 1, b: '2', c: true, d: 'aaa',
    },
    {
      a: [1, 2, 3],
      b: { a: '\\"\x01foo\r\t"\u2028\u2029' },
      skipped: undefined,
      unsupported: new Set(),
    }, {
      sameChild1: sameChildObj,
      sameChild2: sameChildObj,
      sameChild3: [sameChildObj],
    },
  ]) {
    t.equal(jsonDump(obj), JSON.stringify(obj));
  }
  t.throws(() => {
    const cyclic = {};
    cyclic.foo = [1, 2, 3, { cyclic }];
    jsonDump(cyclic);
  }, /Converting circular structure to JSON/, 'circular');
  t.end();
});
