import { INJECT_CONTENT, INJECT_MAPPING, INJECT_PAGE, browser } from '#/common/consts';
import { sendCmd } from '#/common';
import { forEachKey } from '#/common/object';
import bridge from './bridge';
import { allowCommands, appendToRoot, onElement } from './util-content';
import {
  NS_HTML, bindEvents, fireBridgeEvent,
  getUniqIdSafe, isSameOriginWindow, log,
} from '../util';

const INIT_FUNC_NAME = process.env.INIT_FUNC_NAME;
const VAULT_SEED_NAME = INIT_FUNC_NAME + process.env.VAULT_ID_NAME;
let contLists;
let pgLists;
/** @type {Object<string,VMInjectionRealm>} */
let realms;
/** @type boolean */
let pageInjectable;
let frameEventWnd;

// https://bugzil.la/1408996
let VMInitInjection = window[INIT_FUNC_NAME];
/** Avoid running repeatedly due to new `documentElement` or with declarativeContent in Chrome.
 * The prop's mode is overridden to be unforgeable by a userscript in content mode. */
defineProperty(window, INIT_FUNC_NAME, {
  value: 1,
  configurable: false,
  enumerable: false,
  writable: false,
});
window::on(INIT_FUNC_NAME, evt => {
  if (!frameEventWnd) {
    // setupVaultId's first event is the frame's contentWindow
    frameEventWnd = evt::getRelatedTarget();
  } else {
    // setupVaultId's second event is the vaultId
    bridge.post('WriteVault', evt::getDetail(), INJECT_PAGE, frameEventWnd);
    frameEventWnd = null;
  }
});
bridge.addHandlers({
  /**
   * FF bug workaround to enable processing of sourceURL in injected page scripts
   */
  InjectList: IS_FIREFOX && injectList,
  /**
   * Writes the value into the isolated world of the intercepted window
   * @this {Node} window
   */
  VaultId(id) {
    this[VAULT_SEED_NAME] = { id, parent: window };
  },
});

export function injectPageSandbox(contentId, webId) {
  const { cloneInto } = global;
  /* A page can read our script's textContent in a same-origin iframe via DOMNodeRemoved event.
   * Directly preventing it would require redefining ~20 DOM methods in the parent.
   * Instead, we'll send the ids via a temporary handshakeId event, to which the web-bridge
   * will listen only during its initial phase using vault-protected DOM methods. */
  const handshakeId = getUniqIdSafe();
  const handshaker = () => {
    pageInjectable = true;
    bindEvents(contentId, webId, bridge, cloneInto);
    fireBridgeEvent(handshakeId + process.env.HANDSHAKE_ACK, [webId, contentId], cloneInto);
  };
  /* The vault contains safe methods that we got from the highest same-origin parent,
   * where our code ran at document_start so it definitely predated the page scripts. */
  let vaultId = window[VAULT_SEED_NAME];
  if (vaultId) {
    delete window[VAULT_SEED_NAME];
    vaultId = tellParentToWriteVault(vaultId.parent, vaultId.id);
  } else {
    vaultId = !IS_TOP
      && isSameOriginWindow(window.parent)
      && tellParentToWriteVault(window.parent, getUniqIdSafe())
      || '';
  }
  /* With `once` the listener is removed before DOMNodeInserted is dispatched by appendChild,
   * otherwise a same-origin parent page could use it to spoof the handshake. */
  window::on(handshakeId, handshaker, { capture: true, once: true });
  inject({
    code: `(${VMInitInjection}(${IS_FIREFOX},'${handshakeId}','${vaultId}'))()`
      + `\n//# sourceURL=${browser.runtime.getURL('sandbox/injected-web.js')}`,
  });
  // Clean up in case CSP prevented the script from running
  window::off(handshakeId, handshaker, true);
}

/**
 * @param {string} contentId
 * @param {string} webId
 * @param {VMGetInjectedData} data
 */
export async function injectScripts(contentId, webId, data) {
  const { hasMore, info } = data;
  realms = {
    __proto__: null,
    /** @namespace VMInjectionRealm */
    [INJECT_CONTENT]: {
      injectable: true,
      /** @namespace VMRunAtLists */
      lists: contLists = { start: [], body: [], end: [], idle: [] },
      is: 0,
      info,
    },
    [INJECT_PAGE]: {
      injectable: pageInjectable,
      lists: pgLists = { start: [], body: [], end: [], idle: [] },
      is: 0,
      info,
    },
  };
  const feedback = data.scripts.map((script) => {
    const { id } = script.props;
    // eslint-disable-next-line no-restricted-syntax
    const realm = INJECT_MAPPING[script.injectInto].find(key => realms[key]?.injectable);
    // If the script wants this specific realm, which is unavailable, we won't inject it at all
    if (realm) {
      const realmData = realms[realm];
      realmData.lists[script.runAt].push(script); // 'start' or 'body' per getScriptsByURL()
      realmData.is = true;
      allowCommands(script);
    } else {
      bridge.failedIds.push(id);
    }
    return [script.dataKey, realm === INJECT_CONTENT];
  });
  const moreData = sendCmd('InjectionFeedback', {
    feedback,
    pageInjectable,
    feedId: data.feedId,
  });
  // saving while safe
  const getReadyState = hasMore && describeProperty(Document[PROTO], 'readyState').get;
  const hasInvoker = realms[INJECT_CONTENT].is;
  if (hasInvoker) {
    setupContentInvoker(contentId, webId);
  }
  // Using a callback to avoid a microtask tick when the root element exists or appears.
  await onElement('*', async () => {
    injectAll('start');
    const onBody = (pgLists.body.length || contLists.body.length)
      && onElement('body', injectAll, 'body');
    // document-end, -idle
    if (hasMore) {
      data = await moreData;
      if (data) await injectDelayedScripts(!hasInvoker && contentId, webId, data, getReadyState);
    }
    if (onBody) {
      await onBody;
    }
    realms = null;
    pgLists = null;
    contLists = null;
  });
  VMInitInjection = null; // release for GC
}

async function injectDelayedScripts(contentId, webId, { cache, scripts }, getReadyState) {
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
    await new PromiseSafe(resolve => {
      /* Since most sites listen to DOMContentLoaded on `document`, we let them run first
       * by listening on `window` which follows `document` when the event bubbles up. */
      window::on('DOMContentLoaded', resolve, { once: true });
    });
  }
  if (needsInvoker && contentId) {
    setupContentInvoker(contentId, webId);
  }
  scripts::forEach(allowCommands);
  injectAll('end');
  injectAll('idle');
}

function inject(item) {
  const script = document::createElementNS(NS_HTML, 'script');
  // Firefox ignores sourceURL comment when a syntax error occurs so we'll print the name manually
  let onError;
  if (IS_FIREFOX) {
    onError = e => {
      const { stack } = e.error;
      if (!stack || `${stack}`.includes(browser.runtime.getURL(''))) {
        log('error', [item.displayName], e.error);
        e.preventDefault();
      }
    };
    window::on('error', onError);
  }
  // using a safe call to an existing method so we don't have to extract textContent setter
  script::append(item.code);
  // When using declarativeContent there's no documentElement so we'll append to `document`
  if (!appendToRoot(script)) document::appendChild(script);
  if (onError) window::off('error', onError);
  script::remove();
}

function injectAll(runAt) {
  realms::forEachKey((realm) => {
    const realmData = realms[realm];
    const items = realmData.lists[runAt];
    const { info } = realmData;
    if (items.length) {
      bridge.post('ScriptData', { info, items, runAt }, realm);
      info.cache = null;
      if (realm === INJECT_PAGE && !IS_FIREFOX) {
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

function setupContentInvoker(contentId, webId) {
  const invokeContent = VMInitInjection(IS_FIREFOX)(webId, contentId, bridge.onHandle);
  const postViaBridge = bridge.post;
  bridge.post = (cmd, params, realm, node) => {
    const fn = realm === INJECT_CONTENT
      ? invokeContent
      : postViaBridge;
    fn(cmd, params, undefined, node);
  };
}

function tellParentToWriteVault(parent, vaultId) {
  // In FF, content scripts running in a same-origin frame cannot directly call parent's functions
  // TODO: Use a single PointerEvent with `pointerType: vaultId` when strict_min_version >= 59
  parent::fire(new MouseEventSafe(INIT_FUNC_NAME, { relatedTarget: window }));
  parent::fire(new CustomEventSafe(INIT_FUNC_NAME, { detail: vaultId }));
  return vaultId;
}
