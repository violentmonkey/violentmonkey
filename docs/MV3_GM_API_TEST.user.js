// ==UserScript==
// @name         VM3 GM API Test
// @namespace    violentmonkey-mv3-test
// @version      1.0.0
// @description  Smoke test for MV3 GM APIs (value storage, XHR, clipboard) on example.com
// @match        https://example.com/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const TEST_KEY = 'vm3_test_key';
  const TEST_VALUE = 'ok';
  const CLIPBOARD_TEXT = 'vm3 clipboard ok';

  function log(...args) {
    // Console log for developer inspection
    console.log('[VM3_GM_API_TEST]', ...args);
    // Simple DOM marker so you can see something without the console
    try {
      let root = document.getElementById('vm3-gm-api-test');
      if (!root) {
        root = document.createElement('div');
        root.id = 'vm3-gm-api-test';
        root.style.position = 'fixed';
        root.style.zIndex = '2147483647';
        root.style.bottom = '0';
        root.style.left = '0';
        root.style.background = 'rgba(0,0,0,0.8)';
        root.style.color = '#0f0';
        root.style.font = '12px monospace';
        root.style.padding = '4px 6px';
        root.style.maxWidth = '50vw';
        root.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(root);
      }
      const line = document.createElement('div');
      line.textContent = args.map(String).join(' ');
      root.appendChild(line);
    } catch (e) {
      // DOM is best-effort; ignore if it fails
    }
  }

  async function testStorage() {
    try {
      log('Storage: setting', TEST_KEY, 'to', TEST_VALUE);
      await GM_setValue(TEST_KEY, TEST_VALUE);
      const roundTrip = await GM_getValue(TEST_KEY, 'missing');
      const ok = roundTrip === TEST_VALUE;
      log('Storage: getValue returned', JSON.stringify(roundTrip), '=>', ok ? 'PASS' : 'FAIL');
      return ok;
    } catch (e) {
      log('Storage: ERROR', e && e.message);
      return false;
    }
  }

  async function testRequest() {
    return new Promise((resolve) => {
      try {
        log('XHR: requesting https://example.com');
        GM_xmlhttpRequest({
          method: 'GET',
          url: 'https://example.com/',
          responseType: 'text',
          onload: function (res) {
            const status = res && res.status;
            log('XHR: onload status', status, status === 200 ? 'PASS' : 'WARN');
            resolve(status === 200);
          },
          onerror: function (err) {
            log('XHR: onerror', err);
            resolve(false);
          },
          ontimeout: function () {
            log('XHR: ontimeout');
            resolve(false);
          },
        });
      } catch (e) {
        log('XHR: ERROR', e && e.message);
        resolve(false);
      }
    });
  }

  async function testClipboard() {
    try {
      log('Clipboard: calling GM_setClipboard with', JSON.stringify(CLIPBOARD_TEXT));
      // GM_setClipboard may be async or sync depending on implementation; treat as Promise-compatible.
      const result = GM_setClipboard(CLIPBOARD_TEXT);
      if (result && typeof result.then === 'function') {
        await result;
      }
      log('Clipboard: GM_setClipboard invoked => CHECK by pasting', '=>', 'INFO');
      return true;
    } catch (e) {
      log('Clipboard: ERROR', e && e.message);
      return false;
    }
  }

  (async () => {
    log('Starting VM3 GM API smoke test');

    const storageOk = await testStorage();
    const xhrOk = await testRequest();
    const clipboardOk = await testClipboard();

    log('RESULTS:',
      'storage=' + (storageOk ? 'PASS' : 'FAIL'),
      'xhr=' + (xhrOk ? 'PASS' : 'FAIL'),
      'clipboard=' + (clipboardOk ? 'PASS' : 'WARN'));

    log('VM3 GM API smoke test complete');
  })();
})();
