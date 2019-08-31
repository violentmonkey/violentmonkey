import test from 'tape';
import { isRemote, compareVersion } from '#/common';

test('isRemote', (t) => {
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

test('compareVersion', (t) => {
  t.equal(compareVersion('1.2.3', '1.2.3'), 0);
  t.equal(compareVersion('1.2.3', '1.2.0'), 1);
  t.equal(compareVersion('1.2.3', '1.2.4'), -1);
  t.equal(compareVersion('1.2.0', '1.2'), 0);
  t.equal(compareVersion('1.2.1', '1.2'), 1);
  t.equal(compareVersion('1.1.9', '1.2'), -1);
  t.equal(compareVersion('1.10', '1.9'), 1);
  t.end();
});
