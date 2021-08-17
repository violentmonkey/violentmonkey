// UA can be overridden by about:config in FF or devtools in Chrome
// so we'll test for window.chrome.app which is only defined in Chrome
// and for browser.runtime.getBrowserInfo in Firefox 51+

/** @typedef UA
 * @property {false | number} isChrome - Chrome/ium version number or `false`
 * @property {Boolean | number} isFirefox - boolean initially, Firefox version number when ready
 * @property {chrome.runtime.PlatformInfo.arch} arch
 * @property {chrome.runtime.PlatformInfo.os} os
 * @property {string} browserName
 * @property {string} browserVersion
 */
const ua = {};
export default ua;

// using non-enumerable properties that won't be sent to content scripts via GetInjected
Object.defineProperties(ua, {
  isChrome: {
    value: global.chrome?.app && +navigator.userAgent.match(/Chrom\S+?\/(\d+)|$/)[1] || false,
  },
  isFirefox: {
    // will be replaced with the version number in ready()
    value: !!browser.runtime.getBrowserInfo,
    configurable: true,
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
        browserVersion: version || navigator.userAgent.match(/Chrom\S+?\/(\S+)|$/)[1],
      });
      if (ua.isFirefox) {
        Object.defineProperty(ua, 'isFirefox', {
          value: parseFloat(version),
        });
      }
    }),
  },
});
