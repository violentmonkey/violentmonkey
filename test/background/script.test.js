import { ERR_META_SPACE_INSIDE, inferScriptProps, parseMeta } from '@/background/utils/script';

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

test('inferScriptProps homepage', () => {
  const homeOf = url => {
    const script = { custom: { lastInstallURL: url }, meta: {}, props: { id: 1 } };
    inferScriptProps(script);
    return [script.inferred.homepageURL, script.inferred.supportURL];
  };
  expect(homeOf('https://openuserjs.org/install/bob/My_Script.user.js')).toEqual([
    'https://openuserjs.org/scripts/bob/My_Script',
    'https://openuserjs.org/scripts/bob/My_Script/issues',
  ]);
  expect(homeOf('https://openuserjs.org/install/bob/My_Script.min.user.js')[0])
    .toBe('https://openuserjs.org/scripts/bob/My_Script');
  expect(homeOf('https://update.greasyfork.org/scripts/123/Foo.user.js')).toEqual([
    'https://greasyfork.org/scripts/123',
    'https://greasyfork.org/scripts/123/feedback',
  ]);
  expect(homeOf('https://raw.githubusercontent.com/bob/repo/main/foo.user.js')[0])
    .toBe('https://github.com/bob/repo');
});

test('inferScriptProps support URL from @homepageURL', () => {
  const script = {
    custom: {},
    meta: { homepageURL: 'https://openuserjs.org/scripts/bob/My_Script' },
    props: { id: 2 },
  };
  inferScriptProps(script);
  expect(script.inferred.supportURL).toBe('https://openuserjs.org/scripts/bob/My_Script/issues');
});
