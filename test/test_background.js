const assert = require('assert');
const tester = require('../src/background/utils/tester');

describe('tester', () => {
  describe('scheme', () => {
    it('should match all', () => {
      const script = {
        custom: {},
        meta: {
          match: [
            '*://*/*',
          ],
        }
      };
      assert.ok(tester.testURL('https://www.google.com/', script), 'should match `http | https`');
      assert.ok(!tester.testURL('file:///Users/Gerald/file', script), 'should not match `file`');
    });

    it('should match exact', () => {
      const script = {
        custom: {},
        meta: {
          match: [
            'http://*/*',
            'ftp://*/*',
            'file:///*',
          ],
        },
      };
      assert.ok(tester.testURL('http://www.google.com/', script), 'should match `http`');
      assert.ok(!tester.testURL('https://www.google.com/', script), 'should not match `https`');
      assert.ok(tester.testURL('file:///Users/Gerald/file', script), 'should match `file`');
      assert.ok(tester.testURL('ftp://example.com/file', script), 'should match `ftp`');
    });
  });

  describe('host', () => {
    it('should match domain', () => {
      const script = {
        custom: {},
        meta: {
          match: [
            '*://docs.google.com/',
          ],
        },
      };
      assert.ok(tester.testURL('https://docs.google.com/', script), 'should match exact domain name');
      assert.ok(!tester.testURL('https://sub.docs.google.com/', script), 'should not match subdomains');
      assert.ok(!tester.testURL('https://docs.google.com.cn/', script), 'should not match suffixed domains');
    });

    it('should match subdomains', () => {
      const script = {
        custom: {},
        meta: {
          match: [
            '*://*.google.com/',
          ],
        },
      };
      assert.ok(tester.testURL('https://www.google.com/', script), 'should match subdomains');
      assert.ok(tester.testURL('https://a.b.google.com/', script), 'should match subdomains');
      assert.ok(tester.testURL('https://google.com/', script), 'should match specified domain');
      assert.ok(!tester.testURL('https://www.google.com.hk/', script), 'should not match suffixed domains');
    });
  });

  describe('path', () => {
    it('should match any', () => {
      const script = {
        custom: {},
        meta: {
          match: [
            'https://www.google.com/*',
          ],
        },
      };
      assert.ok(tester.testURL('https://www.google.com/', script), 'should match `/`');
      assert.ok(tester.testURL('https://www.google.com/hello/world', script), 'should match any');
    });

    it('should match exact', () => {
      const script = {
        custom: {},
        meta: {
          match: [
            'https://www.google.com/a/b/c',
          ],
        },
      };
      assert.ok(tester.testURL('https://www.google.com/a/b/c', script), 'should match exact');
      assert.ok(!tester.testURL('https://www.google.com/a/b/c/d', script), 'should match exact');
    });
  });
});
