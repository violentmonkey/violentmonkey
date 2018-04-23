import 'src/common/browser';
import { inject, getUniqId, sendMessage } from './utils';
import initialize from './content';

(function main() {
  // Avoid running repeatedly due to new `document.documentElement`
  if (window.VM) return;
  window.VM = 1;

  // Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
  const VMInitInjection = window[process.env.INIT_FUNC_NAME];

  function initBridge() {
    const contentId = getUniqId();
    const webId = getUniqId();
    initialize(contentId, webId).then(needInject => {
      if (needInject) {
        doInject(contentId, webId);
      }
    });
  }

  function doInject(contentId, webId) {
    const props = {};
    [
      Object.getOwnPropertyNames(window),
      Object.getOwnPropertyNames(global),
    ].forEach(keys => {
      keys.forEach(key => { props[key] = 1; });
    });
    const args = [
      webId,
      contentId,
      Object.keys(props),
    ];
    // Avoid using Function::apply in case it is shimmed
    inject(`(${VMInitInjection.toString()}())(${args.map(arg => JSON.stringify(arg)).join(',')})`);
  }

  initBridge();

  // For installation
  // Firefox does not support `onBeforeRequest` for `file:`
  function checkJS() {
    if (!document.querySelector('title')) {
      // plain text
      sendMessage({
        cmd: 'ConfirmInstall',
        data: {
          code: document.body.textContent,
          url: window.location.href,
          from: document.referrer,
        },
      })
      .then(() => {
        if (window.history.length > 1) window.history.go(-1);
        else sendMessage({ cmd: 'TabClose' });
      });
    }
  }
  if (/\.user\.js$/.test(window.location.pathname)) {
    if (document.readyState === 'complete') checkJS();
    else window.addEventListener('load', checkJS, false);
  }
}());
