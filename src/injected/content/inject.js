import { INJECT_CONTENT, INJECT_MAPPING, INJECT_PAGE, browser } from '#/common/consts';
import { sendCmd } from '#/common';
import { forEachKey } from '#/common/object';
import { elemByTag, NS_HTML, log } from '../utils/helpers';
import bridge from './bridge';

// Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
const VMInitInjection = window[process.env.INIT_FUNC_NAME];
// To avoid running repeatedly due to new `document.documentElement`
// (the prop is undeletable so a userscript can't fool us on reinjection)
defineProperty(window, process.env.INIT_FUNC_NAME, { value: 1 });

const stringIncludes = ''.includes;
const resolvedPromise = Promise.resolve();
const { runningIds } = bridge;
let contLists;
let pgLists;
/** @type {Object<string,VMInjectionRealm>} */
let realms;
/** @type boolean */
let pageInjectable;
let badgePromise;
let numBadgesSent = 0;
let bfCacheWired;

bridge.addHandlers({
  __proto__: null, // Object.create(null) may be spoofed
  // FF bug workaround to enable processing of sourceURL in injected page scripts
  InjectList: injectList,
  Run(id, realm) {
    runningIds::push(id);
    bridge.ids::push(id);
    if (realm === INJECT_CONTENT) {
      bridge.invokableIds::push(id);
    }
    if (!badgePromise) {
      badgePromise = resolvedPromise::then(throttledSetBadge);
    }
    if (!bfCacheWired) {
      bfCacheWired = true;
      window::addEventListener('pageshow', evt => {
        // isTrusted is `unforgeable` per DOM spec so we don't need to safeguard its getter
        if (evt.isTrusted && evt.persisted) {
          sendCmd('SetBadge', runningIds);
        }
      });
    }
  },
});

function throttledSetBadge() {
  const num = runningIds.length;
  if (numBadgesSent < num) {
    numBadgesSent = num;
    return sendCmd('SetBadge', runningIds)::then(() => {
      badgePromise = throttledSetBadge();
    });
  }
}

export function appendToRoot(node) {
  // DOM spec allows any elements under documentElement
  // https://dom.spec.whatwg.org/#node-trees
  const root = elemByTag('head') || elemByTag('*');
  return root && root::appendChild(node);
}

export function injectPageSandbox() {
  inject({
    code: `(${VMInitInjection}())('${bridge.webId}','${bridge.contentId}')\n//# sourceURL=${
      browser.runtime.getURL('sandbox/injected-web.js')
    }`,
  });
}

/**
 * @param {VMGetInjectedData} data
 * @param {boolean} isXml
 */
export async function injectScripts(data, isXml) {
  const { hasMore, info } = data;
  pageInjectable = isXml ? false : null;
  realms = {
    __proto__: null, // Object.create(null) may be spoofed
    /** @namespace VMInjectionRealm */
    [INJECT_CONTENT]: {
      injectable: () => true,
      /** @namespace VMRunAtLists */
      lists: contLists = { start: [], body: [], end: [], idle: [] },
      is: 0,
      info,
    },
    [INJECT_PAGE]: {
      injectable: () => pageInjectable ?? checkInjectable(),
      lists: pgLists = { start: [], body: [], end: [], idle: [] },
      is: 0,
      info,
    },
  };
  const feedback = data.scripts.map((script) => {
    const { id } = script.props;
    // eslint-disable-next-line no-restricted-syntax
    const realm = INJECT_MAPPING[script.injectInto].find(key => realms[key]?.injectable());
    // If the script wants this specific realm, which is unavailable, we won't inject it at all
    if (realm) {
      const realmData = realms[realm];
      realmData.lists[script.runAt].push(script); // 'start' or 'body' per getScriptsByURL()
      realmData.is = true;
    } else {
      bridge.failedIds.push(id);
    }
    return [script.dataKey, realm === INJECT_CONTENT];
  });
  const moreData = sendCmd('InjectionFeedback', {
    feedback,
    feedId: data.feedId,
    pageInjectable: pageInjectable ?? (hasMore && checkInjectable()),
  });
  // saving while safe
  const getReadyState = hasMore && describeProperty(Document.prototype, 'readyState').get;
  const hasInvoker = realms[INJECT_CONTENT].is;
  if (hasInvoker) {
    setupContentInvoker();
  }
  // Using a callback to avoid a microtask tick when the root element exists or appears.
  onElement('*', async () => {
    injectAll('start');
    const onBody = (pgLists.body[0] || contLists.body[0])
      && onElement('body', injectAll, 'body');
    // document-end, -idle
    if (hasMore) {
      data = await moreData;
      if (data) await injectDelayedScripts(data, getReadyState, hasInvoker);
    }
    if (onBody) {
      await onBody;
    }
    realms = null;
    pgLists = null;
    contLists = null;
  });
}

async function injectDelayedScripts({ cache, scripts }, getReadyState, hasInvoker) {
  realms::forEachKey(r => {
    realms[r].info.cache = cache;
  });
  let needsInvoker;
  scripts::forEach(script => {
    const { code, runAt } = script;
    if (code && !pageInjectable) {
      bridge.failedIds::push(script.props.id);
    } else {
      (code ? pgLists : contLists)[runAt]::push(script);
      if (!code) needsInvoker = true;
    }
    script.stage = !code && runAt;
  });
  if (document::getReadyState() === 'loading') {
    await new Promise(resolve => {
      /* Since most sites listen to DOMContentLoaded on `document`, we let them run first
       * by listening on `window` which follows `document` when the event bubbles up. */
      window::addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
  if (needsInvoker && !hasInvoker) {
    setupContentInvoker();
  }
  injectAll('end');
  injectAll('idle');
}

function checkInjectable() {
  bridge.addHandlers({
    Pong() {
      pageInjectable = true;
    },
  });
  bridge.post('Ping');
  return pageInjectable;
}

function inject(item) {
  const script = document::createElementNS(NS_HTML, 'script');
  // Firefox ignores sourceURL comment when a syntax error occurs so we'll print the name manually
  let onError;
  if (bridge.isFirefox) {
    onError = e => {
      const { stack } = e.error;
      if (typeof stack === 'string' && stack::stringIncludes(browser.runtime.getURL('/sandbox'))) {
        log('error', [item.displayName], e.error);
        e.preventDefault();
      }
    };
    window::addEventListener('error', onError);
  }
  // using a safe call to an existing method so we don't have to extract textContent setter
  script::append(item.code);
  // When using declarativeContent there's no documentElement so we'll append to `document`
  if (!appendToRoot(script)) document::appendChild(script);
  if (onError) window::removeEventListener('error', onError);
  script::remove();
}

function injectAll(runAt) {
  realms::forEachKey((realm) => {
    const realmData = realms[realm];
    const items = realmData.lists[runAt];
    if (items.length) {
      bridge.post('ScriptData', { items, runAt, info: realmData.info }, realm);
      if (realm === INJECT_PAGE && !bridge.isFirefox) {
        injectList(runAt);
      }
    }
  });
  if (runAt !== 'start' && contLists[runAt].length) {
    bridge.post('RunAt', runAt, INJECT_CONTENT);
  }
}

async function injectList(runAt) {
  const list = pgLists[runAt];
  // Not using for-of because we don't know if @@iterator is safe.
  for (let i = 0, item; (item = list[i]); i += 1) {
    if (item.code) {
      if (runAt === 'idle') await sendCmd('SetTimeout', 0);
      if (runAt === 'end') await 0;
      inject(item);
      item.code = '';
    }
  }
}

/**
 * @param {string} tag
 * @param {function} cb - callback runs immediately, unlike a chained then()
 * @param {?} [args]
 * @returns {Promise<void>}
 */
function onElement(tag, cb, ...args) {
  return new Promise(resolve => {
    if (elemByTag(tag)) {
      cb(...args);
      resolve();
    } else {
      const observer = new MutationObserver(() => {
        if (elemByTag(tag)) {
          observer.disconnect();
          cb(...args);
          resolve();
        }
      });
      // documentElement may be replaced so we'll observe the entire document
      observer.observe(document, { childList: true, subtree: true });
    }
  });
}

function setupContentInvoker() {
  const invokeContent = VMInitInjection()(bridge.webId, bridge.contentId, bridge.onHandle);
  const postViaBridge = bridge.post;
  bridge.post = (cmd, params, realm) => (
    (realm === INJECT_CONTENT ? invokeContent : postViaBridge)(cmd, params)
  );
}
