import bridge, { addHandlers } from './bridge';
import { elemByTag, makeElem, nextTask, onElement, sendCmd } from './util';
import {
  bindEvents, fireBridgeEvent,
  ID_BAD_REALM, ID_INJECTING, INJECT_CONTENT, INJECT_INTO, INJECT_MAPPING, INJECT_PAGE,
  MORE, FEEDBACK, FORCE_CONTENT,
} from '../util';
import { Run } from './cmd-run';

/* In FF, content scripts running in a same-origin frame cannot directly call parent's functions
 * so we'll use the extension's UUID, which is unique per computer in FF, for messages
 * like VAULT_WRITER to avoid interception by sites that can add listeners for all of our
 * INIT_FUNC_NAME ids even though we change it now with each release. */
const VAULT_WRITER = `${IS_FIREFOX ? VM_UUID : INIT_FUNC_NAME}VW`;
const VAULT_WRITER_ACK = `${VAULT_WRITER}+`;
const tardyQueue = [];
let contLists;
let pgLists;
/** @type {Object<string,VMRealmData>} */
let realms;
/** @type {?boolean} */
let pageInjectable;
let frameEventWnd;
/** @type {ShadowRoot} */
let injectedRoot;

// https://bugzil.la/1408996
let VMInitInjection = window[INIT_FUNC_NAME];
/** Avoid running repeatedly due to new `documentElement` or with declarativeContent in Chrome.
 * The prop's mode is overridden to be unforgeable by a userscript in content mode. */
setOwnProp(window, INIT_FUNC_NAME, 1, false);
if (IS_FIREFOX) {
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
  safeDefineProperty(global, VAULT_WRITER, {
    value: tellBridgeToWriteVault,
  });
}

addHandlers({
  /**
   * FF bug workaround to enable processing of sourceURL in injected page scripts
   */
  InjectList: IS_FIREFOX && injectList,
});

export function injectPageSandbox(contentId, webId) {
  pageInjectable = false;
  const vaultId = safeGetUniqId();
  const handshakeId = safeGetUniqId();
  if (useOpener(opener) || useOpener(!IS_TOP && parent)) {
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
    if (opener && describeProperty(opener.location, 'href').get) {
      // TODO: Use a single PointerEvent with `pointerType: vaultId` when strict_min_version >= 59
      if (IS_FIREFOX) {
        const setOk = evt => { ok = evt::getDetail(); };
        window::on(VAULT_WRITER_ACK, setOk, true);
        opener::fire(new SafeMouseEvent(VAULT_WRITER, { relatedTarget: window }));
        opener::fire(new SafeCustomEvent(VAULT_WRITER, { detail: vaultId }));
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
 * @param {string} contentId
 * @param {string} webId
 * @param {VMInjection} data
 * @param {boolean} isXml
 */
export async function injectScripts(contentId, webId, data, isXml) {
  const { errors, info, [MORE]: more } = data;
  if (errors) {
    logging.warn(errors);
  }
  if (IS_FIREFOX) {
    IS_FIREFOX = parseFloat(info.ua.browserVersion); // eslint-disable-line no-global-assign
  }
  realms = {
    __proto__: null,
    [INJECT_CONTENT]: {
      lists: contLists = { start: [], body: [], end: [], idle: [] },
      is: 0,
      info,
    },
    [INJECT_PAGE]: {
      lists: pgLists = { start: [], body: [], end: [], idle: [] },
      is: 0,
      info,
    },
  };
  assign(bridge.cache, data.cache);
  if (isXml || data[FORCE_CONTENT]) {
    pageInjectable = false;
  }
  if (data[INJECT_PAGE] && pageInjectable == null) {
    injectPageSandbox(contentId, webId);
  }
  const feedback = data.scripts.map((script) => {
    const { id } = script.props;
    const realm = INJECT_MAPPING[script[INJECT_INTO]].find(key => (
      key === INJECT_CONTENT || pageInjectable
    ));
    const { runAt } = script;
    // If the script wants this specific realm, which is unavailable, we won't inject it at all
    if (realm) {
      const { pathMap } = script.custom;
      const realmData = realms[realm];
      realmData.lists[runAt].push(script); // 'start' or 'body' per getScriptsByURL()
      realmData.is = true;
      if (pathMap) bridge.pathMaps[id] = pathMap;
    } else {
      bridge.ids[id] = ID_BAD_REALM;
    }
    return [
      script.dataKey,
      realm === INJECT_CONTENT && runAt,
      script.meta.unwrap && id,
    ];
  });
  const moreData = sendCmd('InjectionFeedback', {
    [FEEDBACK]: feedback,
    [FORCE_CONTENT]: !pageInjectable,
    [MORE]: more,
  });
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
    if (more) {
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
    const { code, runAt, custom: { pathMap } } = script;
    const { id } = script.props;
    if (pathMap) {
      bridge.pathMaps[id] = pathMap;
    }
    if (!code) {
      needsInvoker = true;
      safePush(contLists[runAt], script);
    } else if (pageInjectable) {
      safePush(pgLists[runAt], script);
    } else {
      bridge.ids[id] = ID_BAD_REALM;
    }
  });
  if (document::getReadyState() === 'loading') {
    await new SafePromise(resolve => {
      /* Since most sites listen to DOMContentLoaded on `document`, we let them run first
       * by listening on `window` which follows `document` when the event bubbles up. */
      window::on('DOMContentLoaded', resolve, { once: true });
    });
    await 0; // let the site's listeners on `window` run first
  }
  if (needsInvoker && contentId) {
    setupContentInvoker(contentId, webId);
  }
  injectAll('end');
  injectAll('idle');
}

function inject(item, iframeCb) {
  const { code } = item;
  const isCodeArray = isObject(code)
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
    iframeDoc = iframe.contentDocument;
    (iframeDoc ? iframeDoc::getElementsByTagName('*')[0] : divRoot)::appendChild(script);
    if (iframeDoc) iframeCb();
    iframe::remove();
    injectedRoot = null;
  }
  // Clean up in case something didn't load
  script::remove();
  div::remove();
}

function injectAll(runAt) {
  if (process.env.DEBUG) throwIfProtoPresent(realms);
  for (const realm in realms) { /* proto is null */// eslint-disable-line guard-for-in
    const realmData = realms[realm];
    const items = realmData.lists[runAt];
    const { info } = realmData;
    if (items.length) {
      bridge.post('ScriptData', { info, items, runAt }, realm);
      if (realm === INJECT_PAGE && !IS_FIREFOX) {
        injectList(runAt);
      }
      safePush(tardyQueue, items);
      nextTask()::then(tardyQueueCheck);
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
      if (runAt === 'idle') await nextTask();
      if (runAt === 'end') await 0;
      inject(item);
      item.code = '';
      if (item.meta?.unwrap) {
        Run(item.props.id);
      }
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

/**
 * Chrome doesn't fire a syntax error event, so we'll mark ids that didn't start yet
 * as "still starting", so the popup can show them accordingly.
 */
function tardyQueueCheck() {
  for (const items of tardyQueue) {
    for (const script of items) {
      const id = script.props.id;
      if (bridge.ids[id] === 1) bridge.ids[id] = ID_INJECTING;
    }
  }
  tardyQueue.length = 0;
}

function tellBridgeToWriteVault(vaultId, wnd) {
  const { post } = bridge;
  if (post) { // may be absent if this page doesn't have scripts
    post('WriteVault', vaultId, INJECT_PAGE, wnd);
    return true;
  }
}

function addVaultExports(vaultSrc) {
  if (!vaultSrc) return; // blocked by CSP
  const exports = cloneInto(createNullObj(), document);
  // In FF a detached iframe's `console` doesn't print anything, we'll export it from content
  const exportedConsole = cloneInto(createNullObj(), document);
  ['log', 'info', 'warn', 'error', 'debug']::forEach(k => {
    exportedConsole[k] = exportFunction(logging[k], document);
    /* global exportFunction */
  });
  exports.console = exportedConsole;
  // vaultSrc[0] is the iframe's `this`
  // DANGER! vaultSrc[1] must be initialized in injectPageSandbox to prevent prototype hooking
  vaultSrc[1] = exports;
  return true;
}
