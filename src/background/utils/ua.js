import { addOwnCommands, init } from './init';

const info = (() => {
  const uad = navigator.userAgentData;
  let brand, ver, full;
  if (uad) {
    full = uad.getHighEntropyValues(['uaFullVersion']);
    [brand, ver] = uad.brands.map(({ brand: b, version }) => `${
      /Not[^a-z]*A[^a-z]*Brand/i.test(b) ? '4' :
        b === 'Chromium' ? '3' + b :
          b === 'Google Chrome' ? '2' + b :
            '1' + b
    }\n${version}`).sort()[0]?.slice(1).split('\n') || [];
  } else {
    ver = navigator.userAgent.match(/\s(?:Chrom(?:e|ium)|Firefox)\/(\d+[.0-9]*)|$/i)[1];
  }
  return {
    [IS_FIREFOX ? 'FF' : 'CH']: parseFloat(ver) || 1,
    brand,
    full,
    ver,
  };
})();

/** @type {VMScriptGMInfoPlatform} */
export const ua = {};
/** @type {number} This value can be trusted because the only way to spoof it in Chrome/ium
 * is to manually open devtools for the background page in device emulation mode. */
export const CHROME = info.CH;
/** @type {number} DANGER! Until init is done the only sure thing about this value
 * is whether it's truthy, because UA can be overridden by about:config */
export let FIREFOX = info.FF || +IS_FIREFOX;

addOwnCommands({
  UA: () => ua,
});

init.deps.push(
  Promise.all([
    browser.runtime.getPlatformInfo(),
    browser.runtime.getBrowserInfo?.(),
    info.full, // Getting the real version in new Chrome that simplifies its UA as ###.0.0.0
  ]).then(([
    { os, arch },
    { name, version } = {},
    { uaFullVersion } = {},
  ]) => {
    ua.arch = arch;
    ua.os = os;
    ua.brand = ua.browserBrand = info.brand || '';
    ua.name = ua.browserName = name?.toLowerCase() || 'chrome';
    ua.version = ua.browserVersion = uaFullVersion || version || info.ver;
    if (FIREFOX) FIREFOX = parseFloat(version);
  })
);
