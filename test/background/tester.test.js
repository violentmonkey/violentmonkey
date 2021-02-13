import test from 'tape';
import { testScript, testBlacklist, resetBlacklist } from '#/background/utils/tester';
import cache from '#/background/utils/cache';

test.onFinish(cache.destroy);

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

test('scheme', (t) => {
  t.test('should match all', (q) => {
    {
      const script = buildScript({
        meta: {
          match: [
            '*://*/*',
          ],
        },
      });
      q.ok(testScript('http://www.google.com/', script), 'should match `http | https`');
      q.ok(testScript('https://www.google.com/', script), 'should match `http | https`');
      q.notOk(testScript('file:///Users/Gerald/file', script), 'should not match `file`');
    }
    {
      const script = buildScript({
        meta: {
          match: [
            'http*://*/*',
          ],
        },
      });
      q.ok(testScript('http://www.google.com/', script), 'should match `http | https`');
      q.ok(testScript('https://www.google.com/', script), 'should match `http | https`');
      q.notOk(testScript('file:///Users/Gerald/file', script), 'should not match `file`');
    }
    q.end();
  });

  t.test('should match exact', (q) => {
    const script = buildScript({
      meta: {
        match: [
          'http://*/*',
          'ftp://*/*',
          'file:///*',
        ],
      },
    });
    q.ok(testScript('http://www.google.com/', script), 'should match `http`');
    q.notOk(testScript('https://www.google.com/', script), 'should not match `https`');
    q.ok(testScript('file:///Users/Gerald/file', script), 'should match `file`');
    q.ok(testScript('ftp://example.com/file', script), 'should match `ftp`');
    q.end();
  });

  t.end();
});

test('host', (t) => {
  t.test('should match domain', (q) => {
    const script = buildScript({
      meta: {
        match: [
          '*://docs.google.com/',
        ],
      },
    });
    q.ok(testScript('https://docs.google.com/', script), 'should match exact domain name');
    q.notOk(testScript('https://sub.docs.google.com/', script), 'should not match subdomains');
    q.notOk(testScript('https://docs.google.com.cn/', script), 'should not match suffixed domains');
    q.end();
  });

  t.test('should match wildcard', (q) => {
    const script = buildScript({
      meta: {
        match: [
          '*://*.google.com/',
          '*://www.example.*/',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match subdomains');
    q.ok(testScript('https://a.b.google.com/', script), 'should match subdomains');
    q.ok(testScript('https://google.com/', script), 'should match specified domain');
    q.notOk(testScript('https://www.google.com.hk/', script), 'should not match suffixed domains');
    q.ok(testScript('https://www.example.com/', script), 'should match prefix');
    q.ok(testScript('https://www.example.com.cn/', script), 'should match prefix');
    q.ok(testScript('https://www.example.g.com/', script), 'should match prefix');
    q.end();
  });

  t.test('should match tld', (q) => {
    const script = buildScript({
      meta: {
        match: [
          '*://www.google.tld/',
          '*://www.dummy.TLD/', // testing for a mistake: `.tld` should be lowercase
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match subdomains');
    q.ok(testScript('https://www.google.com.cn/', script), 'should match subdomains');
    q.ok(testScript('https://www.google.jp/', script), 'should match tld');
    q.ok(testScript('https://www.google.no-ip.org/', script), 'should match a hyphened `no-ip.org` from Public Suffix List');
    q.notOk(testScript('https://www.google.example.com/', script), 'should not match subdomains');
    q.notOk(testScript('https://www.dummy.com/', script), '`.tld` should be lowercase');
    q.end();
  });

  t.test('should ignore case', (q) => {
    const script = buildScript({
      meta: {
        match: [
          '*://GOOGLE.com/',
        ],
      },
    });
    q.ok(testScript('https://google.COM/', script), 'should ignore case');
    q.end();
  });

  t.end();
});

test('path', (t) => {
  t.test('should match any', (q) => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/*',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match `/`');
    q.ok(testScript('https://www.google.com/hello/world', script), 'should match any');
    q.end();
  });

  t.test('should match exact', (q) => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a/b/c',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/a/b/c', script), 'should match exact');
    q.notOk(testScript('https://www.google.com/a/b/c/d', script), 'should match exact');
    q.end();
  });

  t.test('should ignore query string and hash', (q) => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/a', script), 'should match without query and hash');
    q.ok(testScript('https://www.google.com/a#hash', script), 'should match with hash');
    q.ok(testScript('https://www.google.com/a?query', script), 'should match with query');
    q.ok(testScript('https://www.google.com/a?query#hash', script), 'should match with query and hash');
    q.end();
  });

  t.test('should match query string and hash if existed in rules', (q) => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a?query',
          'https://www.google.com/b#hash',
          'https://www.google.com/c?query#hash',
        ],
      },
    });
    q.notOk(testScript('https://www.google.com/a', script), 'should match query');
    q.notOk(testScript('https://www.google.com/b', script), 'should match hash');
    q.ok(testScript('https://www.google.com/a?query', script), 'should match query');
    q.ok(testScript('https://www.google.com/a?query#hash', script), 'should match query and ignore hash');
    q.notOk(testScript('https://www.google.com/b?query#hash', script), 'should match query and hash');
    q.ok(testScript('https://www.google.com/b#hash', script), 'should match hash');
    q.ok(testScript('https://www.google.com/c?query#hash', script), 'should match query and hash');
    q.end();
  });

  t.test('should be case-sensitive', (q) => {
    const script = buildScript({
      meta: {
        match: [
          'https://www.google.com/a?Query',
          'https://www.google.com/b#Hash',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/a?Query', script), 'query should be case-sensitive');
    q.notOk(testScript('https://www.google.com/a?query', script), 'query should be case-sensitive');
    q.ok(testScript('https://www.google.com/b#Hash', script), 'hash should be case-sensitive');
    q.notOk(testScript('https://www.google.com/b#hash', script), 'hash should be case-sensitive');
    q.end();
  });

  t.end();
});

test('include', (t) => {
  t.test('should include any', (q) => {
    const script = buildScript({
      meta: {
        include: [
          '*',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match `http | https`');
    q.ok(testScript('file:///Users/Gerald/file', script), 'should match `file`');
    q.end();
  });

  t.test('should include by glob', (q) => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.com/*',
          'https://twitter.com/*',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match `/`');
    q.ok(testScript('https://www.google.com/hello/world', script), 'include by prefix');
    q.notOk(testScript('https://www.hello.com/', script), 'not include by prefix');
    q.end();
  });

  t.test('should include by regexp', (q) => {
    const script = buildScript({
      meta: {
        include: [
          '/invalid-regexp(/',
          '/https://www\\.google\\.com/.*/',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should ignore the invalid regexp and match target');
    q.notOk(testScript('https://www.hello.com/', script), 'should not match nontarget');
    q.end();
  });

  t.test('should support magic TLD', (q) => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.tld/*',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match `.com`');
    q.ok(testScript('https://www.google.com.hk/', script), 'should match `.com.hk`');
    q.ok(testScript('https://www.google.no-ip.org/', script), 'should match a hyphened `no-ip.org` from Public Suffix List');
    q.notOk(testScript('https://www.google.example.com/', script), 'should not match subdomains');
    q.end();
  });

  t.test('should ignore case', (q) => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.*',
          '/regexp/',
        ],
      },
    });
    q.ok(testScript('https://www.GOOGLE.com/', script), 'should ignore case');
    q.ok(testScript('https://www.REGEXP.com/', script), 'should ignore case');
    q.end();
  });
});

test('exclude', (t) => {
  t.test('should exclude any', (q) => {
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
    q.notOk(testScript('https://www.google.com/', script), 'should exclude `http | https`');
    q.end();
  });

  t.test('should include by glob', (q) => {
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
    q.notOk(testScript('https://www.google.com/', script), 'should exclude `/`');
    q.notOk(testScript('https://www.google.com/hello/world', script), 'exclude by prefix');
    q.ok(testScript('https://www.hello.com/', script), 'not exclude by prefix');
    q.end();
  });

  t.test('should support magic TLD', (q) => {
    const script = buildScript({
      meta: {
        exclude: [
          'https://www.google.tld/*',
        ],
      },
    });
    q.notOk(testScript('https://www.google.com/', script), 'should match `.com`');
    q.notOk(testScript('https://www.google.com.hk/', script), 'should match `.com.hk`');
    q.notOk(testScript('https://www.google.no-ip.org/', script), 'should match a hyphened `no-ip.org` from Public Suffix List');
    q.ok(testScript('https://www.google.example.com/', script), 'should not match subdomains');
    q.end();
  });
});

test('exclude-match', (t) => {
  t.test('should exclude any', (q) => {
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
    q.notOk(testScript('https://www.google.com/', script), 'should exclude `http | https`');
    q.end();
  });

  t.test('should include by glob', (q) => {
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
    q.notOk(testScript('https://www.google.com/', script), 'should exclude `/`');
    q.notOk(testScript('https://www.google.com/hello/world', script), 'exclude by prefix');
    q.ok(testScript('https://www.hello.com/', script), 'not exclude by prefix');
    q.end();
  });

  t.test('should ignore case only in host', (q) => {
    const script = buildScript({
      meta: {
        match: [
          '*://GOOGLE.com/FOO?BAR#HASH',
        ],
      },
    });
    q.ok(testScript('https://google.COM/FOO?BAR#HASH', script), 'should ignore case in host');
    q.notOk(testScript('https://google.com/foo?bar#hash', script), 'should ignore case in host only');
    q.end();
  });
});

test('custom', (t) => {
  t.test('should ignore original rules', (q) => {
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
    q.ok(testScript('https://twitter.com/', script), 'should match custom rules');
    q.notOk(testScript('https://www.google.com/', script), 'should not match original rules');
    q.end();
  });
});

test('blacklist', (t) => {
  t.test('should exclude match rules', (q) => {
    resetBlacklist(`\
# match rules
*://www.google.com/*
`);
    q.ok(testBlacklist('http://www.google.com/'));
    q.ok(testBlacklist('https://www.google.com/'));
    q.notOk(testBlacklist('https://twitter.com/'));
    q.end();
  });

  t.test('should exclude domains', (q) => {
    resetBlacklist(`\
# domains
www.google.com
`);
    q.ok(testBlacklist('http://www.google.com/'));
    q.ok(testBlacklist('https://www.google.com/'));
    q.notOk(testBlacklist('https://twitter.com/'));
    q.end();
  });

  t.test('should support @exclude rules', (q) => {
    resetBlacklist(`\
# @exclude rules
@exclude https://www.google.com/*
`);
    q.ok(testBlacklist('https://www.google.com/'));
    q.ok(testBlacklist('https://www.google.com/whatever'));
    q.notOk(testBlacklist('http://www.google.com/'));
    q.end();
  });
});
