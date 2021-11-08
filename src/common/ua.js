// UA can be overridden by about:config in FF or devtools in Chrome
// so we'll test for window.chrome.app which is only defined in Chrome
// and for browser.runtime.getBrowserInfo in Firefox 51+

/** @typedef UAExtras
 * @property {number|NaN} chrome - Chrome/ium version number
 * @property {number|NaN} firefox - derived from UA string initially, a real number when `ready`
 * @property {Promise<void>} ready - resolves when `browser` API returns real versions
 */
/** @typedef UAInjected
 * @property {chrome.runtime.PlatformInfo.arch} arch
 * @property {chrome.runtime.PlatformInfo.os} os
 * @property {string} browserName
 * @property {string} browserVersion
 */
/** @type {UAInjected & UAExtras} */
const ua = {};
export default ua;

// using non-enumerable properties that won't be sent to content scripts via GetInjected
Object.defineProperties(ua, {
  chrome: {
    value: matchNavUA(true),
  },
  firefox: {
    value: matchNavUA(), // will be replaced with the real version number in ready()
    writable: true,
  },
  ready: {
    value: Promise.all([
      browser.runtime.getPlatformInfo(),
      browser.runtime.getBrowserInfo?.(),
    ]).then(([{ os, arch }, { name, version } = {}]) => {
      Object.assign(ua, {
        arch,
        os,
        browserName: name?.toLowerCase() || 'chrome',
        browserVersion: version || matchNavUA(true, true),
      });
      if (IS_FIREFOX) {
        ua.firefox = parseFloat(version) || 0;
      }
    }),
  },
});

function matchNavUA(asChrome, asString) {
  const re = new RegExp(`\\s${asChrome ? 'Chrom(e|ium)' : 'Firefox'}/(\\d+[.0-9]*)|$`, 'i');
  const ver = navigator.userAgent.match(re).pop();
  return asString ? ver : parseFloat(ver);
}
