import { isAllSitesPattern, runsOnAllSites } from '@/common/script-scope';

test('isAllSitesPattern: broad patterns', () => {
  [
    '*',
    '<all_urls>',
    '*://*/*',
    '*://*',
    'http://*/*',
    'https://*/*',
    'http*://*',
    'http*://*/*',
    'http*',
    '/.*/',
    '/^https?://.*/',
  ].forEach(p => expect([p, isAllSitesPattern(p)]).toEqual([p, true]));
});

test('isAllSitesPattern: narrow patterns', () => {
  [
    '*://*.example.com/*',
    'https://example.com/*',
    'https://*/foo/*',
    '*://*/recaptcha/api2/*',
    'https://bunkr.*/f/*',
    '/^https://example\\.com/',
    'example',
    '',
    null,
    undefined,
  ].forEach(p => expect([p, isAllSitesPattern(p)]).toEqual([p, false]));
});

test('runsOnAllSites: meta and custom rules', () => {
  const narrow = { match: ['https://example.com/*'], include: [] };
  const broad = { match: ['*://*/*'], include: [] };
  expect(runsOnAllSites({ meta: narrow })).toBe(false);
  expect(runsOnAllSites({ meta: broad })).toBe(true);
  expect(runsOnAllSites({ meta: { match: [], include: ['*'] } })).toBe(true);
  // user replaced the original @match with a narrow one
  expect(runsOnAllSites({ meta: broad, custom: { origMatch: false, match: ['https://a.com/*'] } }))
    .toBe(false);
  // user turned off the original broad @include
  expect(runsOnAllSites({ meta: { match: [], include: ['*'] }, custom: { origInclude: false } }))
    .toBe(false);
  // user added a broad rule to a narrow script
  expect(runsOnAllSites({ meta: narrow, custom: { include: ['*'] } })).toBe(true);
  // excludes do not change the answer
  expect(runsOnAllSites({ meta: { ...broad, exclude: ['https://a.com/*'] } })).toBe(true);
});
