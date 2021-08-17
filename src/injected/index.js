import '#/common/browser';
import { sendCmd } from '#/common';
import './content';

// Script installation in Firefox as it does not support `onBeforeRequest` for `file:`
if (!global.chrome.app
&& global.top === window
&& global.location.protocol === 'file:'
&& global.location.pathname.endsWith('.user.js')) {
  (async () => {
    const {
      browser,
      fetch,
      history,
      document: { referrer },
      Response: { prototype: { text: getText } },
      location: { href: url },
    } = global;
    const fetchOpts = { mode: 'same-origin' };
    const response = await fetch(url, fetchOpts);
    if (!/javascript|^text\/plain|^$/.test(response.headers.get('content-type') || '')) {
      return;
    }
    let code = await response.text();
    if (!/==userscript==/i.test(code)) {
      return;
    }
    await sendCmd('ConfirmInstall', { code, url, from: referrer });
    // FF68+ doesn't allow extension pages to get file: URLs anymore so we need to track it here
    // (detecting FF68 by a feature because we can't use getBrowserInfo here and UA may be altered)
    if (browser.storage.managed) {
      browser.runtime.onConnect.addListener(port => {
        if (port.name !== 'FetchSelf') return;
        let oldCode;
        port.onMessage.addListener(async () => {
          code = await (await fetch(url, fetchOpts))::getText();
          if (code === oldCode) {
            code = null;
          } else {
            oldCode = code;
          }
          port.postMessage(code);
        });
        port.onDisconnect.addListener(closeSelf);
      });
    } else {
      closeSelf();
    }
    function closeSelf() {
      if (history.length > 1) {
        history.go(-1);
      } else {
        sendCmd('TabClose');
      }
    }
  })().catch(console.error); // FF doesn't show exceptions in content scripts
}
