/* global browser */

// UA can be overriden by about:config in FF or devtools in Chrome
// so we'll test for window.chrome.app which is only defined in Chrome
// and for browser.runtime.getBrowserInfo in Firefox 51+
export const isChrome = !!window.chrome?.app;

// eslint-disable-next-line import/no-mutable-exports
export let isFirefox = !!browser.runtime.getBrowserInfo;
browser.runtime.getBrowserInfo?.().then((info) => {
  isFirefox = info.name === 'Firefox' && parseFloat(info.version);
});
