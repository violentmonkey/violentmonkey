import test from 'tape';
import { parseMeta } from '#/background/utils/script';

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

test('parseMeta', (t) => {
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
