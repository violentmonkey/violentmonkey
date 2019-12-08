/* global browser */

// UA can be overriden by about:config in FF or devtools in Chrome
// so we'll test for window.chrome.app which is only defined in Chrome
// and for browser.runtime.BrowserInfo in Firefox 51+
export const isChrome = !!window.chrome?.app;

// eslint-disable-next-line import/no-mutable-exports
export let isFirefox = !isChrome && 'BrowserInfo' in browser.runtime;
// getBrowserInfo doesn't work in content scripts so if they'll ever need the exact version,
// we'll have to pass isFirefox in GetInjected data
browser.runtime.getBrowserInfo?.().then((info) => {
  isFirefox = info.name === 'Firefox' && parseFloat(info.version);
});
