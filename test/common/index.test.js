import test from 'tape';
import {
  isRemote, compareVersion, debounce, throttle,
} from '#/common';
import { mocker } from '../mock';

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
  t.deepEqual([
    '1.2.3',
    '1.2.3-alpha',
    '1.0.0-x.7.z.92',
    '1.0.0-alpha.1',
    '1.0.0-alpha',
    '4.11.6',
    '4.2.0',
    '1.5.19',
    '1.5.5',
    '4.1.3',
    '2.3.1',
    '10.5.5',
    '11.3.0',
    '1.0.0',
    '1.0.0-rc.1',
    '1.0.0-beta.11',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-alpha.beta+build',
    '1.0.0-alpha.1',
    '1.0.0-alpha',
  ].sort(compareVersion), [
    '1.0.0-alpha',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta+build',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0-x.7.z.92',
    '1.0.0',
    '1.2.3-alpha',
    '1.2.3',
    '1.5.5',
    '1.5.19',
    '2.3.1',
    '4.1.3',
    '4.2.0',
    '4.11.6',
    '10.5.5',
    '11.3.0',
  ]);
  t.end();
});

test('debounce', (t) => {
  const log = [];
  const fn = debounce((i) => {
    log.push(i);
  }, 500);
  for (let i = 0; i < 3; i += 1) {
    fn(i);
    mocker.clock.tick(200);
  }
  mocker.clock.tick(500);
  for (let i = 0; i < 3; i += 1) {
    fn(i);
    mocker.clock.tick(600);
  }
  t.deepEqual(log, [2, 0, 1, 2]);
  t.end();
});

test('debounce with invalid time', (t) => {
  for (const time of [undefined, -100]) {
    const log = [];
    const fn = debounce((i) => {
      log.push(i);
    }, time);
    for (let i = 0; i < 3; i += 1) {
      fn(i);
    }
    mocker.clock.tick(500);
    t.deepEqual(log, [2]);
  }
  t.end();
});

test('throttle', (t) => {
  const log = [];
  const fn = throttle((i) => {
    log.push(i);
  }, 500);
  for (let i = 0; i < 6; i += 1) {
    fn(i);
    mocker.clock.tick(200);
  }
  mocker.clock.tick(500);
  for (let i = 0; i < 3; i += 1) {
    fn(i);
    mocker.clock.tick(600);
  }
  t.deepEqual(log, [0, 3, 0, 1, 2]);
  t.end();
});

test('throttle with invalid time', (t) => {
  for (const time of [undefined, -100]) {
    const log = [];
    const fn = throttle((i) => {
      log.push(i);
    }, time);
    for (let i = 0; i < 3; i += 1) {
      fn(i);
    }
    mocker.clock.tick(500);
    t.deepEqual(log, [0]);
  }
  t.end();
});
