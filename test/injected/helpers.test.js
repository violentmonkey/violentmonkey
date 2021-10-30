import test from 'tape';
import { jsonDump } from '#/injected/web/util-web';

test('jsonDump', (t) => {
  // eslint-disable-next-line no-restricted-syntax
  for (const obj of [
    1,
    null,
    false,
    'abc',
    {},
    [],
    [1, 2, 3],
    {
      a: 1, b: '2', c: true, d: 'aaa',
    },
    {
      a: [1, 2, 3],
      b: { a: 'b' },
    },
  ]) {
    t.equal(jsonDump(obj), JSON.stringify(obj));
  }
  t.end();
});
