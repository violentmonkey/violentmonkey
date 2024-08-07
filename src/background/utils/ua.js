import { browserWindows } from '@/common';
import { addOwnCommands, init } from './init';

export const {
  userAgent: navUA,
  userAgentData: navUAD,
} = navigator;
const uaVer = navUA.match(/\s(?:Chrom(?:e|ium)|Firefox)\/(\d+[.0-9]*)|$/i)[1];

/** @type {VMScriptGMInfoPlatform} */
export const ua = {};
/** @type {number|void} This value can be trusted because the only way to spoof it in Chrome/ium
 * is to manually open devtools for the background page in device emulation mode.
 * Using `void` for numeric comparisons like CHROME < 100 to be false in Firefox */
export const CHROME = !IS_FIREFOX ? parseFloat(uaVer) || 1 : undefined;
/** @type {number|void} DANGER! Until init is done the only sure thing about this value
 * is whether it's truthy, because UA can be overridden by about:config.
 * Using `void` for numeric comparisons like FIREFOX < 100 to be false in Chrome */
export let FIREFOX = IS_FIREFOX ? parseFloat(uaVer) || 1 : undefined;

addOwnCommands({
  UA: () => ua,
});

init.deps.push(
  Promise.all([
    browser.runtime.getPlatformInfo(),
    browser.runtime.getBrowserInfo?.(),
    navUAD?.getHighEntropyValues(['fullVersionList']),
    !IS_FIREFOX && browserWindows.getCurrent(),
  ]).then(([
    { os, arch },
    { name, version } = {},
    uadValues,
    wnd,
  ]) => {
    if (!version && (uadValues = uadValues?.fullVersionList) && uadValues[0]) {
      [name, version] = uadValues.map(({ brand, version: v }) => (
        /[^\sa-z]/i.test(brand) ? '3' : // downgrading GREASE value
          brand === 'Chromium' ? '2' + brand : // known generic value
            '1' + brand // preferring non-generic value
      ) + '\n' + v).sort()[0].slice(1).split('\n');
    }
    ua.arch = arch;
    ua.os = os;
    ua.browserName = wnd && (wnd.vivExtData/*new*/ || wnd.extData/*old*/)
      ? 'Vivaldi'
      : name || 'chrome';
    ua.browserVersion = version || uaVer;
    if (FIREFOX) FIREFOX = parseFloat(version);
  })
);
