import test from 'tape';
import { isRemote } from 'src/common';

test('isRemote', t => {
  t.notOk(isRemote());
  t.notOk(isRemote('file:///tmp/file'));
  t.notOk(isRemote('data:text/plain,hello,world'));
  t.ok(isRemote('http://www.google.com'));
  t.ok(isRemote('https://www.google.com'));
  t.end();
});
