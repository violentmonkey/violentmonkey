import {
  expandMatchShorthand, insertMatchLine, parseMeta, wrapMatchPattern,
} from '@/background/utils/script';

test('wrapMatchPattern', () => {
  expect(wrapMatchPattern('example.com')).toBe('*://example.com/*');
  expect(wrapMatchPattern('*.example.com')).toBe('*://*.example.com/*');
  expect(wrapMatchPattern('xyz.*')).toBe('*://xyz.*/*');
  expect(wrapMatchPattern('https://example.com')).toBe('https://example.com/*');
  expect(wrapMatchPattern('*://example.com/*')).toBe('*://example.com/*');
  expect(wrapMatchPattern('example.com/path/*')).toBe('*://example.com/path/*');
  expect(wrapMatchPattern('  ')).toBe('');
  expect(wrapMatchPattern('')).toBe('');
});

test('expandMatchShorthand: comma list + bare domains get expanded', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match       example.com,xyz.*
// @grant       none
// ==/UserScript==
// body
`;
  const out = expandMatchShorthand(code);
  expect(out).toContain('// @match       *://*.example.com/*\n// @match       *://xyz.*/*');
  expect(out).toContain('// body\n');
  expect(parseMeta(out).match).toEqual(['*://*.example.com/*', '*://xyz.*/*']);
});

test('expandMatchShorthand: an already-complete piece stays exact, a bare piece next to it still gets the subdomain wildcard', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match        *://x.com/*,y.com
// @grant       none
// ==/UserScript==
`;
  const out = expandMatchShorthand(code);
  expect(out).toContain('// @match        *://x.com/*\n// @match        *://*.y.com/*');
  expect(parseMeta(out).match).toEqual(['*://x.com/*', '*://*.y.com/*']);
});

test('expandMatchShorthand: already-valid single pattern is left untouched (no-op)', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match        *://example.com/*
// @grant       none
// ==/UserScript==
`;
  expect(expandMatchShorthand(code)).toBe(code);
});

test('expandMatchShorthand: no metablock is a no-op', () => {
  expect(expandMatchShorthand('plain text')).toBe('plain text');
});

test('insertMatchLine: appends after the last @match line', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match       *://a.com/*
// @match       *://b.com/*
// @grant       none
// ==/UserScript==
`;
  const res = insertMatchLine(code, '*://c.com/*');
  expect(res.added).toBe(true);
  expect(res.duplicate).toBe(false);
  const lines = res.code.split('\n');
  const bIdx = lines.findIndex(l => l.includes('b.com'));
  expect(lines[bIdx + 1]).toContain('c.com');
  expect(parseMeta(res.code).match).toEqual(['*://a.com/*', '*://b.com/*', '*://c.com/*']);
});

test('insertMatchLine: detects duplicates and is a no-op', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match       *://a.com/*
// @grant       none
// ==/UserScript==
`;
  const res = insertMatchLine(code, '*://a.com/*');
  expect(res.added).toBe(false);
  expect(res.duplicate).toBe(true);
  expect(res.code).toBe(code);
});

test('insertMatchLine: works when there is no existing @match line', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @grant       none
// ==/UserScript==
`;
  const res = insertMatchLine(code, '*://a.com/*');
  expect(res.added).toBe(true);
  expect(parseMeta(res.code).match).toEqual(['*://a.com/*']);
});
