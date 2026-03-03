import bridge, { addHandlers, grantless } from './bridge';
import { elemByTag, makeElem, nextTask, onElement, sendCmd } from './util';
import { bindEvents, CONSOLE_METHODS, fireBridgeEvent, META_STR } from '../util';
import { Run } from './cmd-run';

const bridgeIds = bridge[IDS];
const kWrappedJSObject = 'wrappedJSObject';
let tardyQueue;
let scriptPhases;
let scriptDiagnostics;
let bridgeInfo;
/** @type {{[runAt: VMScriptRunAt]: VMInjection.Script[]}} */
let contLists, pageLists;
/** @type {?boolean} */
let pageInjectable;
let frameEventWnd;
/** @type {ShadowRoot} */
let injectedRoot;
let invokeContent;
let contentInvokerUnavailable;
let contentInvokerError;
let nonce;
let evalFallbackPending;
let getAttribute = Element[PROTO].getAttribute;
let querySelector = Document[PROTO].querySelector;
const CSP_RE = /(?:^|[;,])\s*(?:script-src(-elem)?|(d)efault-src)(\s+[^;,]+)/g;
const NONCE_RE = /'nonce-([-+/=\w]+)'/;
const UNSAFE_INLINE = "'unsafe-inline'";
const IS_CHROMIUM_MV3 = chrome.runtime.getManifest().manifest_version === 3;
const TARDY_INITIAL_DELAY_MS = IS_CHROMIUM_MV3 ? 500 : 0;
const TARDY_RECHECK_DELAY_MS = IS_CHROMIUM_MV3 ? 750 : 0;
// MV3 content bootstrap can take noticeably longer on large scripts/pages before ScriptEntered fires.
// Keep diagnostics useful but avoid classifying normal startup as a hard stall at ~2s.
const TARDY_MAX_WAIT_MS = IS_CHROMIUM_MV3 ? 12e3 : 0;
const TARDY_FALLBACK_GRACE_MS = IS_CHROMIUM_MV3 ? 10e3 : 0;

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
  ContentEvalBlocked(data) {
    const scriptId = +data?.scriptId;
    const dataKey = data?.dataKey;
    if (!IS_CHROMIUM_MV3 || !(scriptId > 0) || !dataKey) return;
    if (!evalFallbackPending) evalFallbackPending = createNullObj();
    evalFallbackPending[scriptId] = Date.now();
    markScriptPhase(scriptId, 'fallback-dispatched', {
      realm: CONTENT,
      checkPhase: 'eval-fallback-dispatch',
    });
    sendCmd('InjectionFeedback', {
      [CONTENT]: [[scriptId, dataKey]],
      url: location.href,
    }).catch((error) => {
      if (process.env.DEBUG) {
        logging.warn('[vm.bootstrap]', 'content-eval-fallback-failed', {
          scriptId,
          reason: `${error?.message || error || ''}`.slice(0, 400),
          pageUrl: location.href,
        });
      }
    });
  },
});

export function injectPageSandbox(data) {
  if (IS_CHROMIUM_MV3) {
    pageInjectable = false;
    return false;
  }
  pageInjectable = false;
  const VAULT_WRITER = data[kSessionId] + 'VW';
  const VAULT_WRITER_ACK = VAULT_WRITER + '*';
  const vaultId = safeGetUniqId();
  const handshakeId = safeGetUniqId();
  const contentId = safeGetUniqId();
  const webId = safeGetUniqId();
  nonce = data.nonce || getPageNonce();
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
  } else if (window === top) {
    // In top-level pages there is no parent-frame vault handoff to protect,
    // so avoid the iframe fallback path that triggers sandbox warnings.
    startHandshake();
  } else if (IS_CHROMIUM_MV3) {
    // Chromium MV3 blocks inline script in this sandboxed about:blank iframe path.
    // Falling back to content realm avoids noisy CSP violations and broken handshakes.
  } else {
    /* Sites can do window.open(sameOriginUrl,'iframeNameOrNewWindowName').opener=null, spoof JS
     * environment and easily hack into our communication channel before our content scripts run.
     * Content scripts will see `document.opener = null`, not the original opener, so we have
     * to use an iframe to extract the safe globals. Detection via document.referrer won't work
     * is it can be emptied by the opener page, too. */
    inject({ code: `parent["${vaultId}"] = [this, 0]`/* DANGER! See addVaultExports */ }, () => {
      if (!IS_FIREFOX || addVaultExports(window[kWrappedJSObject][vaultId])) {
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

function getPageNonce() {
  const node = document::querySelector('script[nonce],style[nonce],link[nonce]');
  return node?.nonce || node?.getAttribute?.('nonce') || '';
}

/**
 * @param {VMInjection} data
 * @param {VMInjection.Info} info
 * @param {boolean} isXml
 */
export async function injectScripts(data, info, isXml) {
  const { errors, [MORE]: more } = data;
  const BODY = 'body';
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
  const forceContentByMeta = !isXml && hasStrictMetaCsp();
  if (isXml || data[FORCE_CONTENT] || forceContentByMeta || IS_CHROMIUM_MV3) {
    pageInjectable = false;
  } else if (data[PAGE] && pageInjectable == null) {
    injectPageSandbox(data);
  }
  let toContent;
  if (IS_CHROMIUM_MV3) {
    toContent = [];
    for (const scr of data[SCRIPTS]) {
      triageScript(scr);
    }
  } else {
    toContent = data[SCRIPTS]
      .filter(scr => triageScript(scr) === CONTENT)
      .map(scr => [scr.id, scr.key.data]);
  }
  const shouldDeferFeedback = IS_CHROMIUM_MV3;
  let moreData;
  if (!shouldDeferFeedback && (more || toContent.length)) {
    moreData = sendFeedback(toContent, more);
  }
  const getReadyState = describeProperty(Document[PROTO], 'readyState').get;
  const wasInjectableFF = IS_FIREFOX && !nonce && pageInjectable;
  const pageBodyScripts = pageLists?.[BODY];
  if (wasInjectableFF) {
    getAttribute = Element[PROTO].getAttribute;
    querySelector = document.querySelector;
  }
  tardyQueue = createNullObj();
  scriptPhases = createNullObj();
  scriptDiagnostics = createNullObj();
  evalFallbackPending = createNullObj();
  contentInvokerUnavailable = false;
  contentInvokerError = '';
  // Using a callback to avoid a microtask tick when the root element exists or appears.
  await onElement('*', injectAll, 'start');
  if (!moreData && (more || toContent.length)) {
    // In MV3, send feedback after ScriptData dispatch so content bootstrap setters are ready.
    moreData = sendFeedback(toContent, more);
  }
  if (pageBodyScripts || contLists?.[BODY]) {
    await onElement(BODY, !wasInjectableFF || !pageBodyScripts ? injectAll : arg => {
      if (didPageLoseInjectability(toContent, pageBodyScripts)) {
        pageLists = null;
        contLists ??= createNullObj();
        const arr = contLists[BODY];
        if (arr) {
          for (const scr of pageBodyScripts) safePush(arr, scr);
        } else {
          contLists[BODY] = pageBodyScripts;
        }
        sendFeedback(toContent);
      }
      injectAll(arg);
    }, BODY);
  }
  if (more && (data = await moreData)) {
    assign(bridge[CACHE], data[CACHE]);
    if (wasInjectableFF && didPageLoseInjectability(toContent, data[SCRIPTS])) {
      sendFeedback(toContent);
    }
    for (const scr of data[SCRIPTS]) {
      triageScript(scr);
    }
  }
  // Always dispatch 'end' and 'idle' scripts after DOMContentLoaded regardless of
  // whether a second GetInjected response was needed (more=false). In MV3, all scripts
  // may arrive in the first response, so their contLists['end'] entries must still be
  // dispatched here to install the defineProperty setters before scripting.executeScript.
  if (document::getReadyState() === 'loading') {
    await new SafePromise(resolve => {
      /* Since most sites listen to DOMContentLoaded on `document`, we let them run first
       * by listening on `window` which follows `document` when the event bubbles up. */
      on('DOMContentLoaded', resolve, { once: true });
    });
    await 0; // let the site's listeners on `window` run first
  }
  await injectAll('end');
  await injectAll('idle');
  // release for GC
  // Keep `scriptPhases` alive because delayed `tardyQueueCheck` callbacks may still run.
  // Keep `scriptDiagnostics` for the same reason.
  // `markScriptPhase` resets it lazily for subsequent navigations.
  bridgeInfo = contLists = pageLists = VMInitInjection = null;
}

function markScriptPhase(id, phase, extra) {
  let map = scriptPhases;
  if (!isObject(map)) {
    // Defend against unexpected runtime clobbering so bootstrap diagnostics don't crash injection.
    map = scriptPhases = createNullObj() || {};
  }
  let state = map[id];
  if (!isObject(state)) {
    state = map[id] = {
      phase: '',
      history: [],
    };
  } else if (!isObject(state.history)) {
    state.history = [];
  }
  state.phase = phase;
  const point = {
    phase,
    ts: Date.now(),
    ...extra,
  };
  safePush(state.history, point);
  if (state.history.length > 8) state.history.splice(0, state.history.length - 8);
  return state;
}

function rememberScriptDiagnostics(item, realm, runAt) {
  const bootstrap = bridge.bootstrap || createNullObj();
  const pageBridgeReady = IS_CHROMIUM_MV3
    ? bootstrap.mainBridgeState === 'ready'
    : !!pageInjectable;
  scriptDiagnostics[item.id] = {
    injectInto: item[INJECT_INTO],
    resolvedRealm: realm,
    runAt,
    bridgeReady: !!bridge.post,
    pageBridgeReady,
    navigationType: bootstrap.navigationType || '',
    lastBgResponseMs: bootstrap.getInjectedRttMs || 0,
    swPingState: bootstrap.swPingState || '',
    swPingRttMs: bootstrap.swPingRttMs || 0,
    mainBridgeState: bootstrap.mainBridgeState || '',
    mainBridgeRttMs: bootstrap.mainBridgeRttMs || 0,
    mainBridgeError: bootstrap.mainBridgeError || '',
  };
}

function hasStrictMetaCsp() {
  const meta = document::querySelector('meta[http-equiv="content-security-policy" i]');
  const csp = meta && meta::getAttribute('content');
  if (!csp) return false;
  let match;
  let scriptSrc;
  let scriptElemSrc;
  let defaultSrc;
  let extracted = '';
  CSP_RE.lastIndex = 0;
  while ((match = CSP_RE.exec(csp))) {
    extracted += match[0];
    if (match[2]) defaultSrc = match[3];
    else if (match[1]) scriptElemSrc = match[3];
    else scriptSrc = match[3];
  }
  if (!extracted || extracted.match(NONCE_RE)) return false;
  return !!(scriptSrc && !scriptSrc.includes(UNSAFE_INLINE)
    || scriptElemSrc && !scriptElemSrc.includes(UNSAFE_INLINE)
    || !scriptSrc && !scriptElemSrc && defaultSrc && !defaultSrc.includes(UNSAFE_INLINE));
}

function didPageLoseInjectability(toContent, scripts) {
  let res;
  if (!toContent) { // self-invoked
    pageInjectable = false;
  } else if (
    !(res = document::querySelector('meta[http-equiv="content-security-policy" i]')) ||
    !res::getAttribute('content')
  ) {
    return; // no CSP element in DOM, [un]reasonably assuming it's not removed
  } else {
    toContent.length = 0;
  }
  for (const scr of scripts) {
    const realm = scr[INJECT_INTO];
    if (realm === PAGE
    || realm === AUTO && bridge[INJECT_INTO] !== CONTENT) {
      if (toContent) safePush(toContent, [scr.id, scr.key.data]);
      else scr[INJECT_INTO] = CONTENT;
    }
  }
  res = toContent?.length;
  if (res && pageInjectable) { // may have been cleared when handling pageBodyScriptsFF
    const testId = safeGetUniqId();
    const obj = window[kWrappedJSObject];
    inject({ code: `window["${testId}"]=1` });
    res = obj[testId] !== 1;
    if (res) didPageLoseInjectability(null, scripts);
    else delete obj[testId];
  }
  return res;
}

function sendFeedback(toContent, more) {
  return sendCmd('InjectionFeedback', {
    [FORCE_CONTENT]: !pageInjectable,
    [CONTENT]: toContent,
    [MORE]: more,
    url: IS_FIREFOX && location.href,
  });
}

function triageScript(script) {
  let realm = script[INJECT_INTO];
  realm = IS_CHROMIUM_MV3
    ? CONTENT
    : (realm === AUTO && !pageInjectable) || realm === CONTENT
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
    const { stack } = e[ERROR];
    if (!stack || `${stack}`.includes(VM_UUID)) {
      log(ERROR, [item.displayName + ':' + e.lineno + ':' + e.colno], e[ERROR]);
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
      /* Preventing other content scripts */
      src: 'about:blank',
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
    window::on(ERROR, onError);
  }
  if (!injectedRoot) {
    // When using declarativeContent there's no documentElement so we'll append to `document`
    (elemByTag('*') || document)::appendChild(div);
  }
  if (onError) {
    window::off(ERROR, onError);
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

/** @param {VMScriptRunAt} runAt */
function injectAll(runAt) {
  if (contLists && !invokeContent && !contentInvokerUnavailable) {
    setupContentInvoker();
  }
  if (contLists && contentInvokerUnavailable) {
    reportContentInvokerUnavailable(contLists[runAt], runAt);
    return;
  }
  let res;
  for (let inPage = 1; inPage >= 0; inPage--) {
    const realm = inPage ? PAGE : CONTENT;
    const lists = inPage ? pageLists : contLists;
    const items = lists?.[runAt];
    if (items) {
      bridge.post('ScriptData', { items, info: bridgeInfo[realm] }, realm);
      bridgeInfo[realm] = false; // must be a sendable value to have own prop in the receiver
      for (const item of items) {
        const { id, meta: { grant } } = item;
        tardyQueue[id] = {
          queuedAt: Date.now(),
          nextCheckAt: 0,
        };
        rememberScriptDiagnostics(item, realm, runAt);
        markScriptPhase(id, 'queued', { realm, runAt });
        if (process.env.DEBUG) {
          logging.info('[vm.bootstrap]', 'script-dispatched', {
            scriptId: id,
            injectInto: item[INJECT_INTO],
            realm,
            runAt,
          });
        }
        if (!grant.length) grantless[realm] = 1;
      }
      if (!inPage) scheduleTardyQueueCheck(items, CONTENT, 'post-dispatch', TARDY_INITIAL_DELAY_MS);
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
      // Exposing window.vmXXX setter just before running the script to avoid interception
      if (!scr.meta.unwrap) {
        bridge.post('Plant', scr.key);
        markScriptPhase(scr.id, 'plant-sent', { realm: PAGE, runAt });
      }
      inject(scr);
      markScriptPhase(scr.id, 'injected', { realm: PAGE, runAt });
      scr.code = '';
      if (scr.meta.unwrap) {
        Run(scr.id);
        markScriptPhase(scr.id, 'run-dispatched', { realm: PAGE, runAt });
      }
      scheduleTardyQueueCheck([scr], PAGE, 'post-inject', TARDY_INITIAL_DELAY_MS);
    }
  }
}

function scheduleTardyQueueCheck(scripts, realm, checkPhase, delay = 0) {
  if (delay > 0) {
    setTimeout(() => {
      tardyQueueCheck(scripts, realm, checkPhase);
    }, delay);
  } else {
    nextTask()::then(() => tardyQueueCheck(scripts, realm, checkPhase));
  }
}

function setupContentInvoker() {
  if (typeof VMInitInjection !== 'function') {
    contentInvokerUnavailable = true;
    contentInvokerError = 'VMInitInjection bootstrap helper is unavailable.';
    if (process.env.DEBUG) {
      logging.error('[vm.bootstrap]', 'content-invoker-missing', {
        reason: contentInvokerError,
        href: location.href,
        navigationType: bridge.bootstrap?.navigationType || '',
      });
    }
    return;
  }
  invokeContent = VMInitInjection(IS_FIREFOX)(bridge.onHandle, logging);
  const postViaBridge = bridge.post;
  bridge.post = (cmd, params, realm, node) => {
    const fn = realm === CONTENT
      ? invokeContent
      : postViaBridge;
    fn(cmd, params, undefined, node);
  };
}

function reportContentInvokerUnavailable(items, runAt) {
  if (!items) return;
  const bootstrap = bridge.bootstrap || createNullObj();
  for (const item of items) {
    const id = item.id;
    const phase = markScriptPhase(id, 'content-invoker-missing', {
      realm: CONTENT,
      runAt,
    });
    void sendCmd('DiagnosticsLogScriptIssue', {
      scriptId: id,
      scriptName: item.displayName,
      runAt,
      realm: CONTENT,
      state: ID_INJECTING,
      phase: phase.phase,
      checkPhase: 'content-invoker-missing',
      phaseTrail: phase.history,
      bridgeState: bridgeIds[id],
      injectInto: item[INJECT_INTO] || '',
      resolvedRealm: CONTENT,
      bridgeReady: !!bridge.post,
      pageBridgeReady: false,
      navigationType: bootstrap.navigationType || '',
      lastBgResponseMs: bootstrap.getInjectedRttMs || 0,
      getInjectedAttempts: bootstrap.getInjectedAttempts || 0,
      swPingState: bootstrap.swPingState || '',
      swPingRttMs: bootstrap.swPingRttMs || 0,
      swPingError: bootstrap.swPingError || '',
      mainBridgeState: bootstrap.mainBridgeState || '',
      mainBridgeRttMs: bootstrap.mainBridgeRttMs || 0,
      mainBridgeError: bootstrap.mainBridgeError || '',
      lastRuntimeError: bootstrap.lastRuntimeError || '',
      expectedAck: 'ScriptEntered',
      ackReceived: false,
      reason: contentInvokerError || 'Content bootstrap helper is unavailable.',
      pageUrl: location.href,
      fingerprint: [id, 'content-invoker-missing', location.href].join('|'),
      bootstrapError: {
        message: contentInvokerError || '',
      },
    }).catch(() => {});
  }
}

/**
 * Chrome doesn't fire a syntax error event, so we'll mark ids that didn't start yet
 * as "still starting", so the popup can show them accordingly.
 */
function tardyQueueCheck(scripts, realm = PAGE, checkPhase = 'checkpoint') {
  for (const { id, displayName, [RUN_AT]: runAt } of scripts) {
    if (tardyQueue[id]) {
      const scriptDiag = scriptDiagnostics?.[id] || createNullObj();
      const bootstrap = bridge.bootstrap || createNullObj();
      const pending = isObject(tardyQueue[id]) ? tardyQueue[id] : {
        queuedAt: Date.now(),
        nextCheckAt: 0,
      };
      if (!isObject(tardyQueue[id])) {
        tardyQueue[id] = pending;
      }
      const bridgeState = bridgeIds[id];
      if (bridgeState && bridgeState !== 1 && bridgeState !== ID_INJECTING && bridgeState !== ID_BAD_REALM) {
        markScriptPhase(id, 'started', { realm, runAt, state: bridgeState });
        delete tardyQueue[id];
        if (evalFallbackPending) delete evalFallbackPending[id];
        if (scriptDiagnostics) delete scriptDiagnostics[id];
        continue;
      }
      if (bridgeState === ID_BAD_REALM) {
        markScriptPhase(id, 'bad-realm', { realm, runAt, state: bridgeState });
        delete tardyQueue[id];
        if (evalFallbackPending) delete evalFallbackPending[id];
        if (scriptDiagnostics) delete scriptDiagnostics[id];
        continue;
      }
      if (bridgeState === 1) bridgeIds[id] = ID_INJECTING;
      const now = Date.now();
      const elapsedMs = now - (pending.queuedAt || now);
      const hasEvalFallbackPending = !!evalFallbackPending?.[id];
      const maxWaitMs = TARDY_MAX_WAIT_MS + (hasEvalFallbackPending ? TARDY_FALLBACK_GRACE_MS : 0);
      if (maxWaitMs && elapsedMs < maxWaitMs) {
        markScriptPhase(id, 'awaiting-start', {
          realm,
          runAt,
          checkPhase,
          state: bridgeIds[id],
          elapsedMs,
          evalFallbackPending: hasEvalFallbackPending,
          maxWaitMs,
        });
        if (!pending.nextCheckAt || pending.nextCheckAt <= now) {
          pending.nextCheckAt = now + TARDY_RECHECK_DELAY_MS;
          scheduleTardyQueueCheck([{ id, displayName, [RUN_AT]: runAt }], realm, 'grace-recheck', TARDY_RECHECK_DELAY_MS);
        }
        continue;
      }
      const phase = markScriptPhase(id, 'suspected-stall', {
        realm,
        runAt,
        checkPhase,
        state: bridgeIds[id],
        elapsedMs,
      });
      void sendCmd('DiagnosticsLogScriptIssue', {
        scriptId: id,
        scriptName: displayName,
        runAt,
        realm,
        state: ID_INJECTING,
        phase: phase.phase,
        checkPhase,
        phaseTrail: phase.history,
        bridgeState: bridgeIds[id],
        evalFallbackPending: !!evalFallbackPending?.[id],
        injectInto: scriptDiag.injectInto || '',
        resolvedRealm: scriptDiag.resolvedRealm || realm,
        bridgeReady: scriptDiag.bridgeReady,
        pageBridgeReady: scriptDiag.pageBridgeReady,
        navigationType: scriptDiag.navigationType || bootstrap.navigationType || '',
        lastBgResponseMs: scriptDiag.lastBgResponseMs || bootstrap.getInjectedRttMs || 0,
        getInjectedAttempts: bootstrap.getInjectedAttempts || 0,
        swPingState: scriptDiag.swPingState || bootstrap.swPingState || '',
        swPingRttMs: scriptDiag.swPingRttMs || bootstrap.swPingRttMs || 0,
        swPingError: bootstrap.swPingError || '',
        mainBridgeState: scriptDiag.mainBridgeState || bootstrap.mainBridgeState || '',
        mainBridgeRttMs: scriptDiag.mainBridgeRttMs || bootstrap.mainBridgeRttMs || 0,
        mainBridgeError: scriptDiag.mainBridgeError || bootstrap.mainBridgeError || '',
        lastRuntimeError: bootstrap.lastRuntimeError || '',
        expectedAck: 'ScriptEntered',
        ackReceived: false,
        reason: 'Script did not begin execution after injection.',
        pageUrl: location.href,
        fingerprint: [id, location.href].filter(Boolean).join('|'),
        elapsedMs,
      }).catch(() => {});
      delete tardyQueue[id];
      if (evalFallbackPending) delete evalFallbackPending[id];
      if (scriptDiagnostics) delete scriptDiagnostics[id];
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
