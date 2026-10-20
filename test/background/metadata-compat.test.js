import { getScriptRunAt } from '@/common/script';
import { parseMeta } from '@/background/utils/script';
import { testScriptContext } from '@/background/utils/tester';

const scriptWith = text => ({
  custom: {},
  meta: parseMeta(`// ==UserScript==\n${text}\n// ==/UserScript==`),
});

test('retains every run-in declaration', () => {
  expect(scriptWith(`// @run-in normal-tabs
// @run-in container-id-2
// @run-in container-id-3`).meta.runIn).toEqual([
    'normal-tabs', 'container-id-2', 'container-id-3',
  ]);
});

test('uses document-idle when execution timing is unspecified', () => {
  expect(getScriptRunAt(scriptWith(''))).toBe('idle');
});

test('preserves manual execution timing', () => {
  expect(getScriptRunAt(scriptWith('// @run-at context-menu'))).toBe('context-menu');
});

test('preserves explicit VM timing overrides', () => {
  const script = scriptWith('// @run-at context-menu');
  script.custom.runAt = 'document-start';
  expect(getScriptRunAt(script)).toBe('start');
});

test.each([
  ['normal-tabs', { incognito: false }, true],
  ['normal-tabs', { incognito: true }, false],
  ['normal-tabs', { incognito: false, cookieStoreId: 'firefox-default' }, true],
  ['normal-tabs', { incognito: false, cookieStoreId: 'firefox-container-2' }, false],
  ['incognito-tabs', { incognito: false }, false],
  ['incognito-tabs', { incognito: true }, true],
  ['incognito-tabs', { incognito: false, cookieStoreId: 'firefox-container-2' }, true],
  ['incognito-tabs', { incognito: true, cookieStoreId: 'firefox-private' }, true],
  ['container-id-2', { incognito: false, cookieStoreId: 'firefox-container-2' }, true],
  ['container-id-2', { incognito: false, cookieStoreId: 'firefox-container-3' }, false],
  ['container-id-2', { incognito: true, cookieStoreId: 'firefox-private' }, false],
  ['normal-tabs', undefined, false],
  ['incognito-tabs', undefined, false],
  ['container-id-2', undefined, false],
  ['unknown-tabs', { incognito: false }, false],
])('matches run-in %s in %j as %s', (runIn, context, expected) => {
  expect(testScriptContext(scriptWith(`// @run-in ${runIn}`), context)).toBe(expected);
});

test('matches the union of repeated run-in declarations', () => {
  const script = scriptWith(`// @run-in normal-tabs
// @run-in container-id-3`);
  expect(testScriptContext(script, { incognito: false })).toBe(true);
  expect(testScriptContext(script, { cookieStoreId: 'firefox-container-3' })).toBe(true);
  expect(testScriptContext(script, { cookieStoreId: 'firefox-container-2' })).toBe(false);
  expect(testScriptContext(script, { incognito: true })).toBe(false);
});

test('matches unrestricted scripts without a tab context', () => {
  expect(testScriptContext(scriptWith(''))).toBe(true);
});

test('honors a scalar run-in value parsed by an older version', () => {
  const script = { custom: {}, meta: { runIn: 'incognito-tabs' } };
  expect(testScriptContext(script, { incognito: true })).toBe(true);
  expect(testScriptContext(script, { incognito: false })).toBe(false);
});
