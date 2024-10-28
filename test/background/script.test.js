import { ERR_META_SPACE_INSIDE, parseMeta } from '@/background/utils/script';

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
  const baseMetaFoo = {
    ...baseMeta,
    name: 'foo',
  };
  const parseWeirdMeta = code => {
    const errors = [];
    const res = parseMeta(code, { errors });
    return errors.length ? [res, ...errors] : res;
  };
  expect(parseWeirdMeta(`\
  // ==UserScript==============
// @name foo
 // @namespace bar
// ==/UserScript===================
  `)).toEqual({
    ...baseMetaFoo,
    namespace: 'bar',
  });
  expect(parseWeirdMeta(`\
// ==UserScript==
//@name foo
// ==/UserScript==`)).toEqual([baseMetaFoo,
    ERR_META_SPACE_INSIDE + `"//@name foo"`,
  ]);
  expect(parseWeirdMeta(`\
//==UserScript==
// @name foo
//\t==/UserScript==`)).toEqual([baseMetaFoo,
    ERR_META_SPACE_INSIDE + `"//==UserScript=="`,
    ERR_META_SPACE_INSIDE + String.raw`"//\t==/UserScript=="`,
  ]);
  expect(parseWeirdMeta(`\
/*
//
  ==UserScript==
// @name foo
//
==/UserScript==
*/`)).toBeFalsy();
});
