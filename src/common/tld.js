import tldjs from 'tldjs';
// import { fromUserSettings } from 'tldjs';
// import Trie from 'tldjs/lib/suffix-trie';
// import { request } from '#/common';

// let tldjs;

// export function initTLD(remote) {
//   // TLD rules are too large to be packed, download them at runtime.
//   const url = 'https://violentmonkey.top/static/tld-rules.json';
//   const key = 'dat:tldRules';
//   browser.storage.local.get(key)
//   .then(({ [key]: tldRules }) => {
//     if (tldRules) return tldRules;
//     if (!remote) return Promise.reject('ignore TLD');
//     return request(url, { responseType: 'json' })
//     .then(({ data: rules }) => {
//       console.info('Downloaded public suffix data');
//       return browser.storage.local.set({ [key]: rules })
//       .then(() => rules);
//     });
//   })
//   .then(tldRules => {
//     console.info('Initialized TLD');
//     tldjs = fromUserSettings({ rules: Trie.fromJson(tldRules) });
//   })
//   .catch(err => {
//     if (process.env.DEBUG) console.error(err);
//     console.info('Failed initializing TLD');
//   });
// }
export function initTLD() {}

function exportMethod(key) {
  return (...args) => tldjs && tldjs[key](...args);
}

export function isReady() {
  return !!tldjs;
}

export const getDomain = exportMethod('getDomain');
export const getSubdomain = exportMethod('getSubdomain');
export const getPublicSuffix = exportMethod('getPublicSuffix');
