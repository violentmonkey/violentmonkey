import { browserWindows } from '@/common';
import { tryBrowserListener } from '@/common/browser-listener';
import { addOwnCommands, initDependency } from './init';

export const {
  userAgent: navUA,
  userAgentData: navUAD,
} = navigator;
const uaVer = navUA.match(/\s(?:Chrom(?:e|ium)|Firefox)\/(\d+[.0-9]*)|$/i)[1];
const kFullVersionList = 'fullVersionList';

/** @type {VMScriptGMInfoPlatform} */
export const ua = {
  mobile: !!(navUAD?.mobile || /Android|iP(?:ad|hone|od)/.test(navUA)
    || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
};
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

initDependency(
  Promise.all([
    getOptionalInfo(browser.runtime, 'getPlatformInfo'),
    getOptionalInfo(browser.runtime, 'getBrowserInfo'),
    getOptionalInfo(navUAD, 'getHighEntropyValues', [kFullVersionList]),
    IS_FIREFOX ? [] : getOptionalInfo(browserWindows, 'getAll'),
  ]).then(([
    { os, arch } = {},
    { name, version } = {},
    { [kFullVersionList]: list } = {},
    [wnd] = [],
  ]) => {
    if (!version && list?.[0]) {
      [name, version] = list.map(({ brand, version: v }) => (
        /[^\sa-z]/i.test(brand) ? '3' : // downgrading GREASE value
          brand === 'Chromium' ? '2' + brand : // known generic value
            '1' + brand // preferring non-generic value
      ) + '\n' + v).sort()[0].slice(1).split('\n');
    }
    ua.arch = arch;
    ua.os = os;
    setBrowserName(name || 'chrome');
    ua.browserVersion = version || uaVer;
    ua[kFullVersionList] = list;
    if (FIREFOX) FIREFOX = parseFloat(version);
    else if (wnd) checkVivaldi(wnd);
    else if (browserWindows?.onCreated) {
      const checkOnce = createdWindow => {
        tryBrowserListener(browserWindows.onCreated, 'removeListener', checkOnce);
        checkVivaldi(createdWindow);
      };
      tryBrowserListener(browserWindows.onCreated, 'addListener', checkOnce);
    }
  })
);

function getOptionalInfo(object, method, ...args) {
  return Promise.resolve().then(() => object?.[method]?.(...args))
    .then(value => value || undefined)
    .catch(() => undefined);
}

function checkVivaldi(wnd) {
  if (wnd.vivExtData/*new*/ || wnd.extData/*old*/) {
    setBrowserName('Vivaldi');
  }
}

function setBrowserName(name) {
  ua.browserName = name;
}
