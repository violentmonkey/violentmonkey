import { sendCmd } from './utils';
import './content';

// Script installation
// Firefox does not support `onBeforeRequest` for `file:`
if (global.location.pathname.endsWith('.user.js')) {
  const { go } = History.prototype;
  const { document, history } = global;
  const { querySelector } = Document.prototype;
  const referrer = document.referrer;
  (async () => {
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        global.addEventListener('load', resolve, { once: true });
      });
    }
    // plain text shouldn't have a <title>
    if (!document::querySelector('title')) {
      await sendCmd('ConfirmInstall', {
        code: document.body.textContent,
        url: global.location.href,
        from: referrer,
      });
      if (history.length > 1) {
        history::go(-1);
      } else {
        sendCmd('TabClose');
      }
    }
  })();
}
