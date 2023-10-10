import { parseMeta } from '@/background/utils/script';

const baseMeta = {
  include: [],
  exclude: [],
  match: [],
  excludeMatch: [],
  require: [],
  grant: [],
  resources: {},
};

test('parseMeta', () => {
  expect(parseMeta(`\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @description This is a script
// @version 1.0
// @match *://*/*
// @grant none
// ==/UserScript==
`)).toEqual(Object.assign({}, baseMeta, {
    name: 'New Script',
    namespace: 'Violentmonkey Scripts',
    description: 'This is a script',
    version: '1.0',
    match: ['*://*/*'],
    grant: ['none'],
  }));
  expect(parseMeta(`\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match *://*/*
// @noframes
// ==/UserScript==
`)).toEqual(Object.assign({}, baseMeta, {
    name: 'New Script',
    namespace: 'Violentmonkey Scripts',
    match: ['*://*/*'],
    noframes: true,
  }));
});

test('parseMetaIrregularities', () => {
  expect(parseMeta(`\
  // ==UserScript==============
// @name foo
 // @namespace bar
// ==/UserScript===================
  `)).toEqual({
    ...baseMeta,
    name: 'foo',
    namespace: 'bar',
  });
  expect(parseMeta(`\
// ==UserScript==
//@name foo
// ==/UserScript==`)).toEqual(baseMeta);
  expect(parseMeta(`\
//==UserScript==
// @name foo
//\t==/UserScript==`)).toBeFalsy();
  expect(parseMeta(`\
/*
//
  ==UserScript==
// @name foo
//
==/UserScript==
*/`)).toBeFalsy();
});
