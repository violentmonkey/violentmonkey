import bridge from './bridge';
import { getOwnProp } from '../util';

const { allow } = bridge;

/**
 * @param {VMInjectedScript | VMScript} script
 */
export const allowCommands = script => {
  const { dataKey } = script;
  allow('Run', dataKey);
  script.meta.grant::forEach(grant => {
    const gm = /^GM[._]/::regexpTest(grant) && grant::slice(3);
    if (grant === 'GM_xmlhttpRequest' || grant === 'GM.xmlHttpRequest' || gm === 'download') {
      allow('AbortRequest', dataKey);
      allow('HttpRequest', dataKey);
    } else if (grant === 'window.close') {
      allow('TabClose', dataKey);
    } else if (grant === 'window.focus') {
      allow('TabFocus', dataKey);
    } else if (gm === 'addElement' || gm === 'addStyle') {
      allow('AddElement', dataKey);
    } else if (gm === 'setValue' || gm === 'deleteValue') {
      allow('UpdateValue', dataKey);
    } else if (gm === 'notification') {
      allow('Notification', dataKey);
      allow('RemoveNotification', dataKey);
    } else if (gm === 'openInTab') {
      allow('TabOpen', dataKey);
      allow('TabClose', dataKey);
    } else if (gm === 'registerMenuCommand') {
      allow('RegisterMenu', dataKey);
    } else if (gm === 'setClipboard') {
      allow('SetClipboard', dataKey);
    } else if (gm === 'unregisterMenuCommand') {
      allow('UnregisterMenu', dataKey);
    }
  });
};

/** When looking for documentElement, use '*' to also support XML pages
 * Note that we avoid spoofed prototype getters by using hasOwnProperty, and not using `length`
 * as it searches for ALL matching nodes when this tag wasn't cached internally. */
export const elemByTag = tag => getOwnProp(document::getElementsByTagName(tag), 0);

export const appendToRoot = node => {
  // DOM spec allows any elements under documentElement
  // https://dom.spec.whatwg.org/#node-trees
  const root = elemByTag('head') || elemByTag('*');
  return root && root::appendChild(node);
};

/**
 * @param {string} tag
 * @param {function} cb - callback runs immediately, unlike a chained then()
 * @param {?} [arg]
 * @returns {Promise<void>}
 */
export const onElement = (tag, cb, arg) => new PromiseSafe(resolve => {
  if (elemByTag(tag)) {
    resolve(cb(arg));
  } else {
    const observer = new MutationObserver(() => {
      if (elemByTag(tag)) {
        observer.disconnect();
        resolve(cb(arg));
      }
    });
    // documentElement may be replaced so we'll observe the entire document
    observer.observe(document, { childList: true, subtree: true });
  }
});
