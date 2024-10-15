import bridge, { addHandlers } from './bridge';
import { elemByTag, makeElem, nextTask, onElement, sendCmd } from './util';
import { bindEvents, CONSOLE_METHODS, fireBridgeEvent, META_STR } from '../util';
import { Run } from './cmd-run';

const bridgeIds = bridge[IDS];
let tardyQueue;
let bridgeInfo;
let contLists;
let pageLists;
/** @type {?boolean} */
let pageInjectable;
let frameEventWnd;
/** @type {ShadowRoot} */
let injectedRoot;
let nonce;

// https://bugzil.la/1408996
let VMInitInjection = window[INIT_FUNC_NAME];
/** Avoid running repeatedly due to new `documentElement` or with declarativeContent in Chrome.
 * The prop's mode is overridden to be unforgeable by a userscript in content mode. */
setOwnProp(window, INIT_FUNC_NAME, 1, false);

addHandlers({
  /**
   * FF bug workaround to enable processing of sourceURL in injected page scripts
   */
  InjectList: IS_FIREFOX && injectPageList,
});

export function injectPageSandbox(data) {
  pageInjectable = false;
  const VAULT_WRITER = data[kSessionId] + 'VW';
  const VAULT_WRITER_ACK = VAULT_WRITER + '*';
  const vaultId = safeGetUniqId();
  const handshakeId = safeGetUniqId();
  const contentId = safeGetUniqId();
  const webId = safeGetUniqId();
  nonce = data.nonce;
  if (IS_FIREFOX) {
    // In FF, content scripts running in a same-origin frame cannot directly call parent's functions
    window::on(VAULT_WRITER, evt => {
      evt::stopImmediatePropagation();
      if (!frameEventWnd) {
        // setupVaultId's first event is the frame's contentWindow
        frameEventWnd = evt::getRelatedTarget();
      } else {
        // setupVaultId's second event is the vaultId
        frameEventWnd::fire(new SafeCustomEvent(VAULT_WRITER_ACK, {
          __proto__: null,
          detail: tellBridgeToWriteVault(evt::getDetail(), frameEventWnd),
        }));
        frameEventWnd = null;
      }
    }, true);
  } else {
    setOwnProp(global, VAULT_WRITER, tellBridgeToWriteVault, false);
  }
  if (useOpener(opener) || useOpener(window !== top && parent)) {
    startHandshake();
  } else {
    /* Sites can do window.open(sameOriginUrl,'iframeNameOrNewWindowName').opener=null, spoof JS
     * environment and easily hack into our communication channel before our content scripts run.
     * Content scripts will see `document.opener = null`, not the original opener, so we have
     * to use an iframe to extract the safe globals. Detection via document.referrer won't work
     * is it can be emptied by the opener page, too. */
    inject({ code: `parent["${vaultId}"] = [this, 0]`/* DANGER! See addVaultExports */ }, () => {
      if (!IS_FIREFOX || addVaultExports(window.wrappedJSObject[vaultId])) {
        startHandshake();
      }
    });
  }
  return pageInjectable;

  function useOpener(opener) {
    let ok;
    try {
      ok = opener && describeProperty(opener.location, 'href').get;
    } catch (e) {
      // Old Chrome throws in sandboxed frames, TODO: remove `try` when minimum_chrome_version >= 86
    }
    if (ok) {
      ok = false;
      // TODO: Use a single PointerEvent with `pointerType: vaultId` when strict_min_version >= 59
      if (IS_FIREFOX) {
        const setOk = evt => { ok = evt::getDetail(); };
        window::on(VAULT_WRITER_ACK, setOk, true);
        try {
          opener::fire(new SafeMouseEvent(VAULT_WRITER, { relatedTarget: window }));
          opener::fire(new SafeCustomEvent(VAULT_WRITER, { detail: vaultId }));
        } catch (e) { /* FF quirk or bug: opener may reject our fire */ }
        window::off(VAULT_WRITER_ACK, setOk, true);
      } else {
        ok = opener[VAULT_WRITER];
        ok = ok && ok(vaultId, window);
      }
    }
    return ok;
  }
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
    bindEvents(contentId, webId, bridge);
    fireBridgeEvent(`${handshakeId}*`, [webId, contentId]);
  }
}

/**
 * @param {VMInjection} data
 * @param {VMInjection.Info} info
 * @param {boolean} isXml
 */
export async function injectScripts(data, info, isXml) {
  const { errors, [MORE]: more } = data;
  const CACHE = 'cache';
  if (errors) {
    logging.warn(errors);
  }
  info.gmi = {
    isIncognito: chrome.extension.inIncognitoContext,
  };
  bridgeInfo = createNullObj();
  bridgeInfo[PAGE] = info;
  bridgeInfo[CONTENT] = info;
  assign(bridge[CACHE], data[CACHE]);
  if (isXml || data[FORCE_CONTENT]) {
    pageInjectable = false;
  } else if (data[PAGE] && pageInjectable == null) {
    injectPageSandbox(data);
  }
  const toContent = data[SCRIPTS]
    .filter(scr => triageScript(scr) === CONTENT)
    .map(scr => [scr.id, scr.key.data]);
  const moreData = (more || toContent.length)
    && sendCmd('InjectionFeedback', {
      [FORCE_CONTENT]: !pageInjectable,
      [CONTENT]: toContent,
      [MORE]: more,
      url: IS_FIREFOX && location.href,
    });
  const getReadyState = describeProperty(Document[PROTO], 'readyState').get;
  const hasInvoker = contLists;
  if (hasInvoker) {
    setupContentInvoker();
  }
  tardyQueue = createNullObj();
  // Using a callback to avoid a microtask tick when the root element exists or appears.
  await onElement('*', injectAll, 'start');
  if (pageLists?.body || contLists?.body) {
    await onElement('body', injectAll, 'body');
  }
  if (more && (data = await moreData)) {
    assign(bridge[CACHE], data[CACHE]);
    if (document::getReadyState() === 'loading') {
      await new SafePromise(resolve => {
        /* Since most sites listen to DOMContentLoaded on `document`, we let them run first
         * by listening on `window` which follows `document` when the event bubbles up. */
        on('DOMContentLoaded', resolve, { once: true });
      });
      await 0; // let the site's listeners on `window` run first
    }
    for (const scr of data[SCRIPTS]) {
      triageScript(scr);
    }
    if (contLists && !hasInvoker) {
      setupContentInvoker();
    }
    await injectAll('end');
    await injectAll('idle');
  }
  // release for GC
  bridgeInfo = contLists = pageLists = VMInitInjection = null;
}

function triageScript(script) {
  let realm = script[INJECT_INTO];
  realm = (realm === AUTO && !pageInjectable) || realm === CONTENT
    ? CONTENT
    : pageInjectable && PAGE;
  if (realm) {
    const lists = realm === CONTENT
      ? contLists || (contLists = createNullObj())
      : pageLists || (pageLists = createNullObj());
    const { gmi, [META_STR]: metaStr, pathMap, [RUN_AT]: runAt } = script;
    const list = lists[runAt] || (lists[runAt] = []);
    safePush(list, script);
    setOwnProp(gmi, 'scriptMetaStr', metaStr[0]
      || script.code[metaStr[1]]::slice(metaStr[2], metaStr[3]));
    delete script[META_STR];
    if (pathMap) bridge.pathMaps[script.id] = pathMap;
  } else {
    bridgeIds[script.id] = ID_BAD_REALM;
  }
  return realm;
}

function inject(item, iframeCb) {
  const { code } = item;
  const isCodeArray = isObject(code);
  const script = makeElem('script', !isCodeArray && code);
  // Firefox ignores sourceURL comment when a syntax error occurs so we'll print the name manually
  const onError = IS_FIREFOX && !iframeCb && (e => {
    const { stack } = e.error;
    if (!stack || `${stack}`.includes(VM_UUID)) {
      log('error', [item.displayName], e.error);
      e.preventDefault();
    }
  });
  const div = makeElem('div');
  // Hiding the script's code from mutation events like DOMNodeInserted or DOMNodeRemoved
  const divRoot = injectedRoot || (
    attachShadow
      ? div::attachShadow({ mode: 'closed' })
      : div
  );
  if (isCodeArray) {
    safeApply(append, script, code);
  }
  addNonceAttribute(script);
  let iframe;
  let iframeDoc;
  if (iframeCb) {
    iframe = makeElem('iframe', {
      /* Preventing other content scripts */// eslint-disable-next-line no-script-url
      src: 'javascript:void 0',
      sandbox: 'allow-same-origin allow-scripts',
      style: 'display:none!important',
    });
    /* In FF the opener receives DOMNodeInserted attached at creation so it can see window[0] */
    if (!IS_FIREFOX) {
      divRoot::appendChild(iframe);
    }
  } else {
    divRoot::appendChild(script);
  }
  if (onError) {
    window::on('error', onError);
  }
  if (!injectedRoot) {
    // When using declarativeContent there's no documentElement so we'll append to `document`
    (elemByTag('*') || document)::appendChild(div);
  }
  if (onError) {
    window::off('error', onError);
  }
  if (iframeCb) {
    injectedRoot = divRoot;
    if (IS_FIREFOX) divRoot::appendChild(iframe);
    // Can be removed in DOMNodeInserted by a hostile web page or CSP forbids iframes(?)
    if ((iframeDoc = iframe.contentDocument)) {
      iframeDoc::getElementsByTagName('*')[0]::appendChild(script);
      iframeCb();
    }
    iframe::remove();
    injectedRoot = null;
  }
  // Clean up in case something didn't load
  script::remove();
  div::remove();
}

function injectAll(runAt) {
  let res;
  for (let inPage = 1; inPage >= 0; inPage--) {
    const realm = inPage ? PAGE : CONTENT;
    const lists = inPage ? pageLists : contLists;
    const items = lists?.[runAt];
    if (items) {
      bridge.post('ScriptData', { items, info: bridgeInfo[realm] }, realm);
      bridgeInfo[realm] = false; // must be a sendable value to have own prop in the receiver
      for (const { id } of items) tardyQueue[id] = 1;
      if (!inPage) nextTask()::then(() => tardyQueueCheck(items));
      else if (!IS_FIREFOX) res = injectPageList(runAt);
    }
  }
  return res;
}

async function injectPageList(runAt) {
  const scripts = pageLists[runAt];
  for (const scr of scripts) {
    if (scr.code) {
      if (runAt === 'idle') await nextTask();
      if (runAt === 'end') await 0;
      tardyQueueCheck([scr]);
      // Exposing window.vmXXX setter just before running the script to avoid interception
      if (!scr.meta.unwrap) bridge.post('Plant', scr.key);
      inject(scr);
      scr.code = '';
      if (scr.meta.unwrap) Run(scr.id);
    }
  }
}

function setupContentInvoker() {
  const invokeContent = VMInitInjection(IS_FIREFOX)(bridge.onHandle, logging);
  const postViaBridge = bridge.post;
  bridge.post = (cmd, params, realm, node) => {
    const fn = realm === CONTENT
      ? invokeContent
      : postViaBridge;
    fn(cmd, params, undefined, node);
  };
}

/**
 * Chrome doesn't fire a syntax error event, so we'll mark ids that didn't start yet
 * as "still starting", so the popup can show them accordingly.
 */
function tardyQueueCheck(scripts) {
  for (const { id } of scripts) {
    if (tardyQueue[id]) {
      if (bridgeIds[id] === 1) bridgeIds[id] = ID_INJECTING;
      delete tardyQueue[id];
    }
  }
}

function tellBridgeToWriteVault(vaultId, wnd) {
  const { post } = bridge;
  if (post) { // may be absent if this page doesn't have scripts
    post('WriteVault', vaultId, PAGE, wnd);
    return true;
  }
}

export function addNonceAttribute(script) {
  if (nonce) script::setAttribute('nonce', nonce);
}

function addVaultExports(vaultSrc) {
  if (!vaultSrc) return; // blocked by CSP
  const exports = cloneInto(createNullObj(), document);
  // In FF a detached iframe's `console` doesn't print anything, we'll export it from content
  const exportedConsole = cloneInto(createNullObj(), document);
  CONSOLE_METHODS::forEach(k => {
    exportedConsole[k] = exportFunction(logging[k], document);
    /* global exportFunction */
  });
  exports.console = exportedConsole;
  // vaultSrc[0] is the iframe's `this`
  // DANGER! vaultSrc[1] must be initialized in injectPageSandbox to prevent prototype hooking
  vaultSrc[1] = exports;
  return true;
}
