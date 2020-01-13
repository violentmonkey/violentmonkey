import { getUniqId, sendCmd } from './utils';
import { addEventListener, match } from './utils/helpers';
import initialize from './content';

(function main() {
  // Avoid running repeatedly due to new `document.documentElement`
  const VM_KEY = '__Violentmonkey';
  // Literal `1` guards against <html id="__Violentmonkey">, more info in browser.js
  if (window[VM_KEY] === 1) return;
  window[VM_KEY] = 1;

  function initBridge() {
    const contentId = getUniqId();
    const webId = getUniqId();
    initialize(contentId, webId);
  }

  initBridge();

  const { go } = History.prototype;
  const { querySelector } = Document.prototype;
  const { get: getReadyState } = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState');
  // For installation
  // Firefox does not support `onBeforeRequest` for `file:`
  async function checkJS() {
    if (!document::querySelector('title')) {
      // plain text
      await sendCmd('ConfirmInstall', {
        code: document.body.textContent,
        url: window.location.href,
        from: document.referrer,
      });
      if (window.history.length > 1) window.history::go(-1);
      else sendCmd('TabClose');
    }
  }
  if (window.location.pathname::match(/\.user\.js$/)) {
    if (document::getReadyState() === 'complete') checkJS();
    else window::addEventListener('load', checkJS, { once: true });
  }
}());
