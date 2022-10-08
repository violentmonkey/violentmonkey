import { jsonDump } from '@/injected/web/util';

test('jsonDump', () => {
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
    expect(jsonDump(obj)).toEqual(JSON.stringify(obj));
  }
  expect(() => {
    const cyclic = {};
    cyclic.foo = [1, 2, 3, { cyclic }];
    jsonDump(cyclic);
  }).toThrow(/Converting circular structure to JSON/);
});
