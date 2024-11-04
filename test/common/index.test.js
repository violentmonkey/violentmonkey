import {
  isRemote, compareVersion, debounce, throttle,
  loadQuery, dumpQuery, getLocaleString,
} from '@/common';

jest.useFakeTimers();

test('isRemote', () => {
  [
    isRemote(),
    isRemote('file:///tmp/file'),
    isRemote('data:text/plain,hello,world'),
    isRemote('http://localhost/a.user.js'),
    isRemote('https://localhost/a.user.js'),
    isRemote('http://127.0.0.1/a.user.js'),
    isRemote('http://127.0.0.1:5555/a.user.js'),
    isRemote('http://192.168.1.32/a.user.js'),
    isRemote('http://172.16.0.1/a.user.js'),
    isRemote('http://10.0.0.1/a.user.js'),
    isRemote('http://[::1]/a.user.js'),
    isRemote('http://[fe80::6996:2ba9:37e6:8762]/a.user.js'),
    isRemote('http://[fc00::90:90]/a.user.js'),
    isRemote('http://example.test/a.user.js'),
    isRemote('https://example.example/a.user.js'),
    isRemote('http://example.invalid/a.user.js'),
    isRemote('https://example.localhost/a.user.js'),
  ].forEach(f => {
    expect(f).toBeFalsy();
  });
  [
    isRemote('http://www.google.com'),
    isRemote('https://www.google.com'),
  ].forEach(t => {
    expect(t).toBeTruthy();
  });
});

test('compareVersion', () => {
  expect(compareVersion('1.2.3', '1.2.3')).toEqual(0);
  expect(compareVersion('1.2.3', '1.2.0')).toEqual(1);
  expect(compareVersion('1.2.3', '1.2.4')).toEqual(-1);
  expect(compareVersion('1.2.0', '1.2')).toEqual(0);
  expect(compareVersion('1.2.1', '1.2')).toEqual(1);
  expect(compareVersion('1.1.9', '1.2')).toEqual(-1);
  expect(compareVersion('1.10', '1.9')).toEqual(1);
  expect([
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
  ].sort(compareVersion)).toEqual([
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
});

test('debounce', () => {
  const log = [];
  const fn = debounce((i) => {
    log.push(i);
  }, 500);
  for (let i = 0; i < 3; i += 1) {
    setTimeout(fn, 200 * i, i);
  }
  for (let i = 0; i < 3; i += 1) {
    setTimeout(fn, 1200 + 600 * i, i);
  }
  jest.runAllTimers();
  expect(log).toEqual([2, 0, 1, 2]);
});

test('debounce with invalid time', () => {
  for (const time of [undefined, -100]) {
    const log = [];
    const fn = debounce((i) => {
      log.push(i);
    }, time);
    for (let i = 0; i < 3; i += 1) {
      fn(i);
    }
    jest.runAllTimers();
    expect(log).toEqual([2]);
  }
});

test('throttle', () => {
  const log = [];
  const fn = throttle((i) => {
    log.push(i);
  }, 500);
  for (let i = 0; i < 6; i += 1) {
    setTimeout(fn, 200 * i, i);
  }
  for (let i = 0; i < 3; i += 1) {
    setTimeout(fn, 1200 + 600 * i, i);
  }
  jest.runAllTimers();
  expect(log).toEqual([0, 3, 0, 1, 2]);
});

test('throttle with invalid time', () => {
  for (const time of [undefined, -100]) {
    const log = [];
    const fn = throttle((i) => {
      log.push(i);
    }, time);
    for (let i = 0; i < 3; i += 1) {
      fn(i);
    }
    jest.runAllTimers();
    expect(log).toEqual([0]);
  }
});

test('loadQuery/dumpQuery', () => {
  const str = 'a=%7C%23%2C&b=&c';
  const normalized = `${new URLSearchParams(str)}`;
  const obj = loadQuery(str);
  expect(obj).toEqual({ a: '|#,', b: '', c: '' });
  expect(dumpQuery(obj)).toEqual(normalized);
});

test('getLocaleString', () => {
  const meta = {
    'name': 'name without locale',
    'name:zh': 'name for zh',
    'name:zh-CN': 'name for zh-CN',
    'name:zh-TW': 'name for zh-TW',
  };
  expect(getLocaleString(meta, 'name', ['zh-CN', 'zh'])).toBe('name for zh-CN');
  expect(getLocaleString(meta, 'name', ['zh', 'zh-CN'])).toBe('name for zh');
  expect(getLocaleString(meta, 'name', ['zh-Hant-TW', 'zh-Hant', 'zh'])).toBe('name for zh-TW');
  expect(getLocaleString(meta, 'name', ['zh-Hant', 'zh'])).toBe('name for zh');
  expect(getLocaleString(meta, 'name', ['en', 'en-US'])).toBe('name without locale');
});
