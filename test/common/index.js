import test from 'tape';
import { isRemote } from '#/common';

test('isRemote', t => {
  t.notOk(isRemote());
  t.notOk(isRemote('file:///tmp/file'));
  t.notOk(isRemote('data:text/plain,hello,world'));
  t.ok(isRemote('http://www.google.com'));
  t.ok(isRemote('https://www.google.com'));
  t.notOk(isRemote('http://localhost/a.user.js'));
  t.notOk(isRemote('https://localhost/a.user.js'));
  t.notOk(isRemote('http://127.0.0.1/a.user.js'));
  t.end();
});
