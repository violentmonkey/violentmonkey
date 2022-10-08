import { MatchTest, resetBlacklist, testScript, testBlacklist } from '@/background/utils/tester';
import cache from '@/background/utils/cache';

afterEach(cache.destroy);

function buildScript(props) {
  return Object.assign({
    custom: {
      origInclude: true,
      origExclude: true,
      origMatch: true,
      origExcludeMatch: true,
    },
    meta: {},
  }, props);
}

describe('scheme', () => {
  test('should match all', () => {
    {
      const script = buildScript({
        meta: {
          match: [
            '*://*/*',
          ],
        },
      });
      expect(testScript('http://www.google.com/', script)).toBeTruthy();
      expect(testScript('https://www.google.com/', script)).toBeTruthy();
      expect(testScript('file:///Users/Gerald/file', script)).toBeFalsy();
    }
    {
      const script = buildScript({
        meta: {
          match: [
            'http*://*/*',
          ],
        },
      });
      expect(testScript('http://www.google.com/', script)).toBeTruthy();
      expect(testScript('https://www.google.com/', script)).toBeTruthy();
      expect(testScript('file:///Users/Gerald/file', script)).toBeFalsy();
    }
  });

  test('should match exact', () => {
    const script = buildScript({
      meta: {
        match: [
          'http://*/*',
          'ftp://*/*',
          'file:///*',
        ],
      },
    });
    expect(testScript('http://www.google.com/', script)).toBeTruthy();
    expect(testScript('https://www.google.com/', script)).toBeFalsy();
    expect(testScript('file:///Users/Gerald/file', script)).toBeTruthy();
    expect(testScript('ftp://example.com/file', script)).toBeTruthy();
  });
});

describe('host', () => {
  test('should match domain', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://docs.google.com/',
        ],
      },
    });
    expect(testScript('https://docs.google.com/', script)).toBeTruthy();
    expect(testScript('https://sub.docs.google.com/', script)).toBeFalsy();
    expect(testScript('https://docs.google.com.cn/', script)).toBeFalsy();
  });

  test('should match wildcard', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://*.google.com/',
          '*://www.example.*/',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://a.b.google.com/',
      'https://google.com/',
      'https://www.example.com/',
      'https://www.example.com.cn/',
      'https://www.example.g.com/',
    ].forEach(url => {
        expect(testScript(url, script)).toBeTruthy();
      });
    expect(testScript('https://www.google.com.hk/', script)).toBeFalsy();
  });

  test('should match tld', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://www.google.tld/',
          '*://www.dummy.TLD/', // testing for a mistake: `.tld` should be lowercase
        ],
      },
    });
    [
    'https://www.google.com/', // should match subdomains
    'https://www.google.com.cn/', // should match subdomains
    'https://www.google.jp/', // should match tld
    'https://www.google.no-ip.org/', // should match a hyphened `no-ip.org` from Public Suffix List
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
    [
      'https://www.google.example.com/',
      'https://www.dummy.com/', // `.tld` should be lowercase
    ].forEach(url => {
      expect(testScript(url, script)).toBeFalsy();
    });
  });

  test('should ignore case', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://GOOGLE.com/',
        ],
      },
    });
    expect(testScript('https://google.COM/', script)).toBeTruthy();
  });
});

describe('path', () => {
  test('should match any', () => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://www.google.com/hello/world',
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
  });

  test('should match exact', () => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a/b/c',
        ],
      },
    });
    expect(testScript('https://www.google.com/a/b/c', script)).toBeTruthy();
    expect(testScript('https://www.google.com/a/b/c/d', script)).toBeFalsy();
  });

  test('should ignore query string and hash', () => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a',
        ],
      },
    });
    [
      'https://www.google.com/a', // should match without query and hash
      'https://www.google.com/a#hash', // should match with hash
      'https://www.google.com/a?query', // should match with query
      'https://www.google.com/a?query#hash', // should match with query and hash
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
  });

  test('should match query string and hash if existed in rules', () => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a?query',
          'https://www.google.com/b#hash',
          'https://www.google.com/c?query#hash',
        ],
      },
    });
    [
      'https://www.google.com/a?query',
      'https://www.google.com/a?query#hash',
      'https://www.google.com/b#hash',
      'https://www.google.com/c?query#hash',
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
    [
      'https://www.google.com/a',
      'https://www.google.com/b',
      'https://www.google.com/b?query#hash',
    ].forEach(url => {
      expect(testScript(url, script)).toBeFalsy();
    });
  });

  test('should be case-sensitive', () => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a?Query',
          'https://www.google.com/b#Hash',
        ],
      },
    });
    [
      'https://www.google.com/a?Query',
      'https://www.google.com/b#Hash',
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
    [
      'https://www.google.com/a?query',
      'https://www.google.com/b#hash',
    ].forEach(url => {
      expect(testScript(url, script)).toBeFalsy();
    });
  });
});

describe('include', () => {
  test('should include any', () => {
    const script = buildScript({
      meta: {
        include: [
          '*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'file:///Users/Gerald/file'
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
  });

  test('should include by glob', () => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.com/*',
          'https://twitter.com/*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://www.google.com/hello/world',
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
    expect(testScript('https://www.hello.com/', script)).toBeFalsy();
  });

  test('should include by regexp', () => {
    const script = buildScript({
      meta: {
        include: [
          '/invalid-regexp(/',
          '/https://www\\.google\\.com/.*/',
        ],
      },
    });
    expect(testScript('https://www.google.com/', script)).toBeTruthy();
    expect(testScript('https://www.hello.com/', script)).toBeFalsy();
  });

  test('should support magic TLD', () => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.tld/*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://www.google.com.hk/',
      'https://www.google.no-ip.org/',
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
    expect(testScript('https://www.google.example.com/', script)).toBeFalsy();
  });

  test('should ignore case', () => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.*',
          '/regexp/',
        ],
      },
    });
    [
      'https://www.GOOGLE.com/',
      'https://www.REGEXP.com/',
    ].forEach(url => {
      expect(testScript(url, script)).toBeTruthy();
    });
  });
});

describe('exclude', () => {
  test('should exclude any', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://*/*',
        ],
        exclude: [
          '*',
        ],
      },
    });
    expect(testScript('https://www.google.com/', script)).toBeFalsy();
  });

  test('should include by glob', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://*/*',
        ],
        excludeMatch: [
          'https://www.google.com/*',
          'https://twitter.com/*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://www.google.com/hello/world',
    ].forEach(url => {
      expect(testScript(url, script)).toBeFalsy();
    });
    expect(testScript('https://www.hello.com/', script)).toBeTruthy();
  });

  test('should support magic TLD', () => {
    const script = buildScript({
      meta: {
        exclude: [
          'https://www.google.tld/*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://www.google.com.hk/',
      'https://www.google.no-ip.org/',
    ].forEach(url => {
      expect(testScript(url, script)).toBeFalsy();
    });
    expect(testScript('https://www.google.example.com/', script)).toBeTruthy();
  });
});

describe('exclude-match', () => {
  test('should exclude any', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://*/*',
        ],
        excludeMatch: [
          '*://*/*',
        ],
      },
    });
    expect(testScript('https://www.google.com/', script)).toBeFalsy();
  });

  test('should include by glob', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://*/*',
        ],
        excludeMatch: [
          'https://www.google.com/*',
          'https://twitter.com/*',
        ],
      },
    });
    [
      'https://www.google.com/',
      'https://www.google.com/hello/world',
    ].forEach(url => {
      expect(testScript(url, script)).toBeFalsy();
    });
    expect(testScript('https://www.hello.com/', script)).toBeTruthy();
  });

  test('should ignore case only in host', () => {
    const script = buildScript({
      meta: {
        match: [
          '*://GOOGLE.com/FOO?BAR#HASH',
        ],
      },
    });
    expect(testScript('https://google.COM/FOO?BAR#HASH', script)).toBeTruthy();
    expect(testScript('https://google.com/foo?bar#hash', script)).toBeFalsy();
  });
});

describe('@match error reporting', () => {
  test('should throw', () => {
    for (const [rule, err] of [
      ['://*/*', 'missing scheme'],
      ['foo://*/*', 'unknown scheme'],
      ['*//*/*', 'missing "://"'],
      ['http:/*/', 'missing "://"'],
      ['htp:*', 'unknown scheme, missing "://"'],
      ['https://foo*', 'missing "/" for path'],
    ]) {
      expect(() => MatchTest.try(rule)).toThrow(`Bad pattern: ${err} in ${rule}`);
    }
  });
});

describe('custom', () => {
  test('should ignore original rules', () => {
    const script = buildScript({
      custom: {
        match: [
          'https://twitter.com/*',
        ],
      },
      meta: {
        match: [
          'https://www.google.com/*',
        ],
      },
    });
    expect(testScript('https://twitter.com/', script)).toBeTruthy();
    expect(testScript('https://www.google.com/', script)).toBeFalsy();
  });
});

describe('blacklist', () => {
  test('should exclude match rules', () => {
    resetBlacklist(`\
# match rules
*://www.google.com/*
`);
    [
      'http://www.google.com/',
      'https://www.google.com/',
    ].forEach(url => {
      expect(testBlacklist(url)).toBeTruthy();
    });
    expect(testBlacklist('https://twitter.com/')).toBeFalsy();
  });

  test('should exclude domains', () => {
    resetBlacklist(`\
# domains
www.google.com
`);
    [
      'http://www.google.com/',
      'https://www.google.com/',
    ].forEach(url => {
      expect(testBlacklist(url)).toBeTruthy();
    });
    expect(testBlacklist('https://twitter.com/')).toBeFalsy();
  });

  test('should support @exclude rules', () => {
    resetBlacklist(`\
# @exclude rules
@exclude https://www.google.com/*
`);
    [
      'https://www.google.com/',
      'https://www.google.com/whatever',
    ].forEach(url => {
      expect(testBlacklist(url)).toBeTruthy();
    });
    expect(testBlacklist('http://www.google.com/')).toBeFalsy();
  });
});
