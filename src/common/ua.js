// UA can be overridden by about:config in FF or devtools in Chrome
// so we'll test for window.chrome.app which is only defined in Chrome
// and for browser.runtime.getBrowserInfo in Firefox 51+

/** @type {VMUserAgent} */
const ua = {};
const kUaFullVersion = 'uaFullVersion'; // for new Chrome which simplifies UA version as #.0.0.0
const uaData = navigator.userAgentData;
export default ua;

// using non-enumerable properties that won't be sent to content scripts via GetInjected
Object.defineProperties(ua, {
  ...IS_FIREFOX ? {
    firefox: {
      value: matchNavUA(), // will be replaced with the real version number in ready()
      writable: true,
    },
  } : {
    chrome: {
      value: uaData && parseFloat(uaData.brands[0].version) || matchNavUA(true),
    },
  },
  ready: {
    value: Promise.all([
      browser.runtime.getPlatformInfo(),
      browser.runtime.getBrowserInfo?.(),
      uaData?.getHighEntropyValues([kUaFullVersion]),
    ]).then(([{ os, arch }, { name, version } = {}, {[kUaFullVersion]: fullVer} = {}]) => {
      Object.assign(ua, {
        arch,
        os,
        browserName: name?.toLowerCase() || 'chrome',
        browserVersion: fullVer || version || matchNavUA(true, true),
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
