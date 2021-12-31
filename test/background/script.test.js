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

test('parseMetaIrregularities', (t) => {
  t.deepEqual(parseMeta(`\
  // ==UserScript==============
// @name foo
 // @namespace bar
// ==/UserScript===================
  `), {
    ...baseMeta,
    name: 'foo',
    namespace: 'bar',
  });
  t.deepEqual(parseMeta(`\
// ==UserScript==
//@name foo
// ==/UserScript==`), baseMeta);
  t.deepEqual(parseMeta(`\
//==UserScript==
// @name foo
//\t==/UserScript==`), baseMeta);
  t.deepEqual(parseMeta(`\
/*
//
  ==UserScript==
// @name foo
//
==/UserScript==
*/`), baseMeta);
  t.end();
});
