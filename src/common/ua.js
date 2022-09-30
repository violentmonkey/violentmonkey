// UA can be overridden by about:config in FF or devtools in Chrome
// so we'll test for window.chrome.app which is only defined in Chrome
// and for browser.runtime.getBrowserInfo in Firefox 51+

/** @type {VMUserAgent} */
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
