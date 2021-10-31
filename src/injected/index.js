import '#/common/browser';
import { sendCmd } from '#/common';
import './content';

// Script installation in Firefox as it does not support `onBeforeRequest` for `file:`
const url = IS_FIREFOX && IS_TOP && global.location.href;
if (url
&& /^file:/::regexpTest(url)
&& /\.user\.js$/::regexpTest(url)) {
  (async () => {
    const {
      browser,
      fetch,
      history,
      document: { referrer },
    } = global;
    const { text: getText } = ResponseProto;
    const fetchOpts = { mode: 'same-origin' };
    const response = await fetch(url, fetchOpts);
    if (!/javascript|^text\/plain|^$/::regexpTest(response.headers.get('content-type') || '')) {
      return;
    }
    let code = await response::getText();
    if (!/==userscript==/i::regexpTest(code)) {
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
