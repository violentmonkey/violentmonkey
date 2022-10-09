import '@/common/browser'; // eslint-disable-line no-restricted-imports
import { sendCmd } from '@/common'; // eslint-disable-line no-restricted-imports
import './content';

// Script installation in Firefox as it does not support `onBeforeRequest` for `file:`
// Using pathname and a case-sensitive check to match webRequest `urls` filter behavior
if (IS_FIREFOX && IS_TOP
&& global.location.protocol === 'file:'
&& global.location.pathname.endsWith('.user.js')
&& document.contentType === 'application/x-javascript' // FF uses this for file: scheme
) {
  (async () => {
    const {
      browser,
      fetch,
      history,
      document: { referrer },
    } = global;
    const { text: getText } = ResponseProto;
    const isFF68 = 'cookie' in Document[PROTO];
    const url = global.location.href;
    const fetchCode = async () => (await fetch(url, { mode: 'same-origin' }))::getText();
    let code = await fetchCode();
    let oldCode;
    if (!/==userscript==/i::regexpTest(code)) {
      return;
    }
    await sendCmd('ConfirmInstall', { code, url, from: referrer });
    // FF68+ doesn't allow extension pages to get file: URLs anymore so we need to track it here
    // (detecting FF68 by a feature because we can't use getBrowserInfo here and UA may be altered)
    if (isFF68) {
      /** @param {chrome.runtime.Port} */
      browser.runtime.onConnect.addListener(port => {
        if (port.name !== 'FetchSelf') return;
        port.onMessage.addListener(async () => {
          code = await fetchCode();
          if (code === oldCode) {
            code = null;
          } else {
            oldCode = code;
          }
          port.postMessage(code);
        });
        port.onDisconnect.addListener(async () => {
          oldCode = null;
          // The user may have reloaded the Confirm page so let's check
          if (!await sendCmd('CheckInstallerTab', port.sender.tab.id)) {
            closeSelf();
          }
        });
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
