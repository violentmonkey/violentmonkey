import bridge from './bridge';
import { elemByTag, makeElem, onElement, sendCmd } from './util-content';
import {
  bindEvents, fireBridgeEvent,
  INJECT_CONTENT, INJECT_MAPPING, INJECT_PAGE, browser,
} from '../util';

/* In FF, content scripts running in a same-origin frame cannot directly call parent's functions
 * so we'll use the extension's UUID, which is unique per computer in FF, for messages
 * like VAULT_WRITER to avoid interception by sites that can add listeners for all of our
 * INIT_FUNC_NAME ids even though we change it now with each release. */
const INIT_FUNC_NAME = process.env.INIT_FUNC_NAME;
const VM_UUID = browser.runtime.getURL('');
const VAULT_WRITER = `${VM_UUID}VW`;
const VAULT_WRITE_ACK = `${VAULT_WRITER}+`;
const DISPLAY_NONE = 'display:none!important';
let contLists;
let pgLists;
/** @type {Object<string,VMInjectionRealm>} */
let realms;
/** @type boolean */
let pageInjectable;
let frameEventWnd;
let elShadow;
let elShadowRoot;

// https://bugzil.la/1408996
let VMInitInjection = window[INIT_FUNC_NAME];
/** Avoid running repeatedly due to new `documentElement` or with declarativeContent in Chrome.
 * The prop's mode is overridden to be unforgeable by a userscript in content mode. */
defineProperty(window, INIT_FUNC_NAME, {
  __proto__: null,
  value: 1,
  configurable: false,
  enumerable: false,
  writable: false,
});
if (IS_FIREFOX) {
  window::on(VAULT_WRITER, evt => {
    evt::stopImmediatePropagation();
    if (!frameEventWnd) {
      // setupVaultId's first event is the frame's contentWindow
      frameEventWnd = evt::getRelatedTarget();
    } else {
      // setupVaultId's second event is the vaultId
      tellBridgeToWriteVault(evt::getDetail(), frameEventWnd);
      frameEventWnd::fire(new CustomEventSafe(VAULT_WRITE_ACK));
      frameEventWnd = null;
    }
  }, true);
} else {
  safeDefineProperty(global, VAULT_WRITER, {
    value: tellBridgeToWriteVault,
  });
}

bridge.addHandlers({
  /**
   * FF bug workaround to enable processing of sourceURL in injected page scripts
   */
  InjectList: IS_FIREFOX && injectList,
});

export function injectPageSandbox(contentId, webId) {
  const { cloneInto } = global;
  const isSpoofable = document.referrer.startsWith(`${window.location.origin}/`);
  const vaultId = isSpoofable && getUniqIdSafe();
  const handshakeId = getUniqIdSafe();
  if (isSpoofable && (
    !WriteVaultFromOpener(window.opener, vaultId)
    && !WriteVaultFromOpener(!IS_TOP && window.parent, vaultId)
  )) {
    /* Sites can do window.open(sameOriginUrl,'iframeNameOrNewWindowName').opener=null, spoof JS
     * environment and easily hack into our communication channel before our content scripts run.
     * Content scripts will see `document.opener = null`, not the original opener, so we have
     * to use an iframe to extract the safe globals. */
    inject({ code: `parent["${vaultId}"] = [this]` }, () => {
      // Skipping page injection in FF if our script element was blocked by site's CSP
      if (!IS_FIREFOX || window.wrappedJSObject[vaultId]) {
        startHandshake();
      }
      contentId = false;
    });
  }
  if (contentId) {
    startHandshake();
  }
  return pageInjectable;

  /** A page can read our script's textContent in a same-origin iframe via DOMNodeRemoved event.
   * Directly preventing it would require redefining ~20 DOM methods in the parent.
   * Instead, we'll send the ids via a temporary handshakeId event, to which the web-bridge
   * will listen only during its initial phase using vault-protected DOM methods.
   * TODO: simplify this when strict_min_version >= 63 (attachShadow in FF) */
  function startHandshake() {
    /* With `once` the listener is removed before DOMNodeInserted is dispatched by appendChild,
     * otherwise a same-origin parent page could use it to spoof the handshake. */
    window::on(handshakeId, handshaker, { capture: true, once: true });
    inject({
      code: `(${VMInitInjection}(${IS_FIREFOX},'${handshakeId}','${vaultId}'))()`
        + `\n//# sourceURL=${VM_UUID}sandbox/injected-web.js`,
    });
    // Clean up in case CSP prevented the script from running
    window::off(handshakeId, handshaker, true);
  }
  function handshaker(evt) {
    pageInjectable = true;
    evt::stopImmediatePropagation();
    bindEvents(contentId, webId, bridge, cloneInto);
    fireBridgeEvent(handshakeId + process.env.HANDSHAKE_ACK, [webId, contentId], cloneInto);
  }
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
  assign(bridge.cache, data.cache);
  const feedback = data.scripts.map((script) => {
    const { id } = script.props;
    // eslint-disable-next-line no-restricted-syntax
    const realm = INJECT_MAPPING[script.injectInto].find(key => realms[key]?.injectable);
    // If the script wants this specific realm, which is unavailable, we won't inject it at all
    if (realm) {
      const { pathMap } = script.custom;
      const realmData = realms[realm];
      realmData.lists[script.runAt].push(script); // 'start' or 'body' per getScriptsByURL()
      realmData.is = true;
      if (pathMap) bridge.pathMaps[id] = pathMap;
      bridge.allowScript(script);
    } else {
      bridge.failedIds.push(id);
    }
    return [script.dataKey, realm === INJECT_CONTENT];
  });
  const moreData = sendCmd('InjectionFeedback', {
    feedback,
    feedId: data.feedId,
    forceContent: !pageInjectable,
  });
  // saving while safe
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
      if (data) await injectDelayedScripts(!hasInvoker && contentId, webId, data);
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

async function injectDelayedScripts(contentId, webId, { cache, scripts }) {
  assign(bridge.cache, cache);
  let needsInvoker;
  scripts::forEach(script => {
    const { code, runAt } = script;
    if (!code) {
      needsInvoker = true;
      contLists[runAt]::push(script);
    } else if (pageInjectable) {
      pgLists[runAt]::push(script);
    } else {
      bridge.failedIds::push(script.props.id);
    }
  });
  if (document::getReadyState() === 'loading') {
    await new PromiseSafe(resolve => {
      /* Since most sites listen to DOMContentLoaded on `document`, we let them run first
       * by listening on `window` which follows `document` when the event bubbles up. */
      window::on('DOMContentLoaded', resolve, { once: true });
    });
    await 0; // let the site's listeners on `window` run first
  }
  if (needsInvoker && contentId) {
    setupContentInvoker(contentId, webId);
  }
  scripts::forEach(bridge.allowScript);
  injectAll('end');
  injectAll('idle');
}

function inject(item, iframeCb) {
  const root = elemByTag('*');
  // In Chrome injectPageSandbox calls inject() another time while the first one still runs
  const isAdded = root && elShadow && root::elemByTag('*') === elShadow;
  const realScript = makeElem('script', item.code);
  let el = realScript;
  let onError;
  let iframe;
  let iframeLoader;
  // Firefox ignores sourceURL comment when a syntax error occurs so we'll print the name manually
  if (IS_FIREFOX) {
    onError = e => {
      const { stack } = e.error;
      if (!stack || `${stack}`.includes(VM_UUID)) {
        log('error', [item.displayName], e.error);
        e.preventDefault();
      }
    };
    window::on('error', onError);
  }
  // Hiding the script's code from mutation events like DOMNodeInserted or DOMNodeRemoved
  if (attachShadow) {
    if (!elShadow) {
      elShadow = makeElem('div');
      elShadowRoot = elShadow::attachShadow({ mode: 'closed' });
      elShadowRoot::appendChild(makeElem('style', `:host { ${DISPLAY_NONE} }`));
      if (iframeCb) {
        iframe = makeElem('iframe', {
          /* Preventing other content scripts in Chrome */// eslint-disable-next-line no-script-url
          src: 'javascript:void 0',
          sandbox: 'allow-scripts allow-same-origin',
          style: DISPLAY_NONE,
        });
        iframeLoader = () => {
          iframeLoader = null;
          iframe.contentDocument::getElementsByTagName('*')[0]::appendChild(realScript);
          iframeCb();
          realScript::remove();
          iframe::remove();
        };
        /* In Chrome, when an empty iframe is inserted into document, `load` is fired synchronously,
         * then `DOMNodeInserted`, also synchronously, then appendChild finishes, then our
         * subsequent code runs. So, we have to use `load` event to run our script,
         * otherwise it can be easily intercepted via DOMNodeInserted. */
        if (!IS_FIREFOX) {
          iframe::on('load', iframeLoader, { once: true });
        }
        elShadowRoot::appendChild(iframe);
      }
    }
    if (!iframe) {
      elShadowRoot::appendChild(realScript);
    }
    el = elShadow;
  }
  // When using declarativeContent there's no documentElement so we'll append to `document`
  if (!isAdded) (root || document)::appendChild(el);
  if (iframeLoader) iframeLoader();
  if (onError) window::off('error', onError);
  // Clean up in case something didn't load
  if (iframe) iframe::remove();
  if (attachShadow) realScript::remove();
  el::remove();
}

function injectAll(runAt) {
  for (const realm in realms) { /* proto is null */// eslint-disable-line guard-for-in
    const realmData = realms[realm];
    const items = realmData.lists[runAt];
    const { info } = realmData;
    if (items.length) {
      bridge.post('ScriptData', { info, items, runAt }, realm);
      if (realm === INJECT_PAGE && !IS_FIREFOX) {
        injectList(runAt);
      }
    }
  }
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

function WriteVaultFromOpener(opener, vaultId) {
  let ok;
  if (opener && describeProperty(opener.location, 'href').get) {
    // TODO: Use a single PointerEvent with `pointerType: vaultId` when strict_min_version >= 59
    if (IS_FIREFOX) {
      const setOk = () => { ok = true; };
      window::on(VAULT_WRITE_ACK, setOk, true);
      opener::fire(new MouseEventSafe(VAULT_WRITER, { relatedTarget: window }));
      opener::fire(new CustomEventSafe(VAULT_WRITER, { detail: vaultId }));
      window::off(VAULT_WRITE_ACK, setOk, true);
    } else {
      ok = opener[VAULT_WRITER];
      if (ok) ok(vaultId, window);
    }
  }
  return ok;
}

function tellBridgeToWriteVault(vaultId, wnd) {
  bridge.post('WriteVault', vaultId, INJECT_PAGE, wnd);
}
