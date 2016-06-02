define('tests/background', function (require, exports, module) {
  var tester = require('utils/tester');

  QUnit.module('utils/tester', function (hooks) {
    hooks.beforeEach(function (assert) {
      this.script = {
        custom: {},
        meta: {},
      };
    });

    QUnit.module('test match', function (hooks) {
      QUnit.module('match scheme', function (hooks) {
        QUnit.test('match all', function (assert) {
          this.script.meta.match = [
            '*://*/*',
          ];
          assert.ok(tester.testURL('https://www.google.com/', this.script), 'should match `http | https`');
          assert.ok(!tester.testURL('file:///Users/Gerald/file', this.script), 'should not match `file`');
        });

        QUnit.test('match exact', function (assert) {
          this.script.meta.match = [
            'http://*/*',
            'ftp://*/*',
            'file:///*',
          ];
          assert.ok(tester.testURL('http://www.google.com/', this.script), 'should match `http`');
          assert.ok(!tester.testURL('https://www.google.com/', this.script), 'should not match `https`');
          assert.ok(tester.testURL('file:///Users/Gerald/file', this.script), 'should match `file`');
          assert.ok(tester.testURL('ftp://example.com/file', this.script), 'should match `ftp`');
        });
      });

      QUnit.module('match host', function (hooks) {
        QUnit.test('match all', function (assert) {
          this.script.meta.match = [
            '*://*/',
          ];
          assert.ok(tester.testURL('https://www.google.com/', this.script), 'should match any');
        });

        QUnit.test('match exact domain', function (assert) {
          this.script.meta.match = [
            '*://docs.google.com/',
          ];
          assert.ok(tester.testURL('https://docs.google.com/', this.script), 'should match exact domain name');
          assert.ok(!tester.testURL('https://sub.docs.google.com/', this.script), 'should not match subdomains');
          assert.ok(!tester.testURL('https://docs.google.com.cn/', this.script), 'should not match suffixed domains');
        });

        QUnit.test('match subdomains', function (assert) {
          this.script.meta.match = [
            '*://*.google.com/',
          ];
          assert.ok(tester.testURL('https://www.google.com/', this.script), 'should match subdomains');
          assert.ok(tester.testURL('https://a.b.google.com/', this.script), 'should match subdomains');
          assert.ok(tester.testURL('https://google.com/', this.script), 'should match specified domain');
          assert.ok(!tester.testURL('https://www.google.com.hk/', this.script), 'should not match suffixed domains');
        });
      });

      QUnit.module('match path', function (hooks) {
        QUnit.test('match any', function (assert) {
          this.script.meta.match = [
            'https://www.google.com/*',
          ];
          assert.ok(tester.testURL('https://www.google.com/', this.script), 'should match `/`');
          assert.ok(tester.testURL('https://www.google.com/hello/world', this.script), 'should match any');
        });

        QUnit.test('match exact', function (assert) {
          this.script.meta.match = [
            'https://www.google.com/a/b/c',
          ];
          assert.ok(tester.testURL('https://www.google.com/a/b/c', this.script), 'should match exact');
          assert.ok(!tester.testURL('https://www.google.com/a/b/c/d', this.script), 'should match exact');
        });
      });
    });
  });
});
