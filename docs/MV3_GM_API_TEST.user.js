// ==UserScript==
// @name         VM3 GM API Test
// @namespace    violentmonkey
// @version      0.1.0
// @match        https://example.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// ==/UserScript==

(async () => {
  await GM_setValue('vm3_test_key', 'ok');
  const value = await GM_getValue('vm3_test_key', 'missing');
  console.log('VM3 GM API: getValue', value);

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://example.com',
    onload: res => console.log('VM3 GM API: xhr status', res.status),
    onerror: err => console.error('VM3 GM API: xhr error', err),
  });

  GM_setClipboard('vm3 clipboard ok');
  console.log('VM3 GM API: setClipboard attempted');
})();
