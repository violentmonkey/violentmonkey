import test from 'tape';
import { testScript, testBlacklist, resetBlacklist } from 'src/background/utils/tester';
import cache from 'src/background/utils/cache';

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

test('scheme', t => {
  t.test('should match all', q => {
    const script = buildScript({
      meta: {
        match: [
          '*://*/*',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match `http | https`');
    q.notOk(testScript('file:///Users/Gerald/file', script), 'should not match `file`');
    q.end();
  });

  t.test('should match exact', q => {
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

test('host', t => {
  t.test('should match domain', q => {
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

  t.test('should match subdomains', q => {
    const script = buildScript({
      meta: {
        match: [
          '*://*.google.com/',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match subdomains');
    q.ok(testScript('https://a.b.google.com/', script), 'should match subdomains');
    q.ok(testScript('https://google.com/', script), 'should match specified domain');
    q.notOk(testScript('https://www.google.com.hk/', script), 'should not match suffixed domains');
    q.end();
  });

  t.end();
});

test('path', t => {
  t.test('should match any', q => {
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

  t.test('should match exact', q => {
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

  t.end();
});

test('include', t => {
  t.test('should include any', q => {
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

  t.test('should include by regexp', q => {
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

  t.test('should support magic TLD', q => {
    const script = buildScript({
      meta: {
        include: [
          'https://www.google.tld/*',
        ],
      },
    });
    q.ok(testScript('https://www.google.com/', script), 'should match `.com`');
    q.ok(testScript('https://www.google.com.hk/', script), 'should match `.com.hk`');
    q.notOk(testScript('https://www.google.example.com/', script), 'should not match subdomains');
    q.end();
  });
});

test('exclude', t => {
  t.test('should exclude any', q => {
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

  t.test('should include by regexp', q => {
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

  t.test('should support magic TLD', q => {
    const script = buildScript({
      meta: {
        exclude: [
          'https://www.google.tld/*',
        ],
      },
    });
    q.notOk(testScript('https://www.google.com/', script), 'should match `.com`');
    q.notOk(testScript('https://www.google.com.hk/', script), 'should match `.com.hk`');
    q.ok(testScript('https://www.google.example.com/', script), 'should not match subdomains');
    q.end();
  });
});

test('exclude-match', t => {
  t.test('should exclude any', q => {
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

  t.test('should include by regexp', q => {
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
});

test('custom', t => {
  t.test('should ignore original rules', q => {
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

test('blacklist', t => {
  t.test('should exclude match rules', q => {
    resetBlacklist(`\
# match rules
*://www.google.com/*
`);
    q.ok(testBlacklist('http://www.google.com/'));
    q.ok(testBlacklist('https://www.google.com/'));
    q.notOk(testBlacklist('https://twitter.com/'));
    q.end();
  });

  t.test('should exclude domains', q => {
    resetBlacklist(`\
# domains
www.google.com
`);
    q.ok(testBlacklist('http://www.google.com/'));
    q.ok(testBlacklist('https://www.google.com/'));
    q.notOk(testBlacklist('https://twitter.com/'));
    q.end();
  });

  t.test('should support @exclude rules', q => {
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
