import test from 'tape';
import { compareVersion, parseMeta } from '#/background/utils/script';

test('compareVersion', t => {
  t.equal(compareVersion('1.2.3', '1.2.3'), 0);
  t.equal(compareVersion('1.2.3', '1.2.0'), 1);
  t.equal(compareVersion('1.2.3', '1.2.4'), -1);
  t.equal(compareVersion('1.2.0', '1.2'), 0);
  t.equal(compareVersion('1.2.1', '1.2'), 1);
  t.equal(compareVersion('1.1.9', '1.2'), -1);
  t.equal(compareVersion('1.10', '1.9'), 1);
  t.end();
});

const baseMeta = {
  include: [],
  exclude: [],
  match: [],
  excludeMatch: [],
  require: [],
  grant: [],
  resources: {},
  noframes: false,
};

test('parseMeta', t => {
  t.deepEqual(parseMeta(`\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @description This is a script
// @version 1.0
// @match *://*/*
// @grant none
// ==/UserScript==
`), Object.assign({}, baseMeta, {
    name: 'New Script',
    namespace: 'Violentmonkey Scripts',
    description: 'This is a script',
    version: '1.0',
    match: ['*://*/*'],
    grant: ['none'],
  }));
  t.deepEqual(parseMeta(`\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match *://*/*
// @noframes
// ==/UserScript==
`), Object.assign({}, baseMeta, {
    name: 'New Script',
    namespace: 'Violentmonkey Scripts',
    match: ['*://*/*'],
    noframes: true,
  }));
  t.end();
});
