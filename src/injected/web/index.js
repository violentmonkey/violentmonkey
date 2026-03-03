import bridge, { addHandlers, callbacks, displayNames } from './bridge';
import { commands, storages } from './store';
import { GM_API_CTX } from './gm-api';
import { makeGmApiWrapper } from './gm-api-wrapper';
import './gm-values';
import './notifications';
import './requests';
import './tabs';
import { bindEvents, CONSOLE_METHODS } from '../util';
import { safeConcat } from './util';

// Make sure to call safe::methods() in code that may run after userscripts

const toRun = createNullObj();
const toRunById = createNullObj();
const startedScripts = createNullObj();
const grantlessUsage = createNullObj();
const SCRIPT_ENTERED_HOOK = '__VM_SCRIPT_ENTERED__';
const EVAL_BLOCKED_CSP_RE = /unsafe-eval|violates the following content security policy directive/i;
const FALLBACK_CLEANUP_DELAY_MS = 15000;
const FALLBACK_POLL_MS = 100;
const FALLBACK_MAX_WAIT_MS = 12000;

export default function initialize(invokeHost, console) {
  if (PAGE_MODE_HANDSHAKE) {
    window::on(PAGE_MODE_HANDSHAKE + '*', e => {
      e = e::getDetail();
      bindEvents(e[0], e[1], bridge);
    }, { __proto__: null, once: true, capture: true });
    window::fire(new SafeCustomEvent(PAGE_MODE_HANDSHAKE));
    bridge.mode = PAGE;
    addHandlers({
      /** @this {Node} contentWindow */
      WriteVault(id) {
        this[id] = VAULT;
      },
    });
    /* Can't use a detached `console` in Chrome 109+ due to https://crrev.com/1063194 */
    if (!IS_FIREFOX) {
      for (const m of CONSOLE_METHODS) {
        logging[m] = (...args) => bridge.post('Log', [m, args]);
      }
      /** @this {GMContext} */
      GM_API_CTX.GM_log = function (...args) {
        bridge.post('Log', ['log', safeConcat([`[${this.displayName}]`], args)]);
      };
    }
  } else {
    bridge.mode = CONTENT;
    bridge.post = (cmd, data, node) => {
      invokeHost({ cmd, data, node }, CONTENT);
    };
    setOwnProp(window, SCRIPT_ENTERED_HOOK, onScriptEnteredFromWrapper, false);
    global.chrome = undefined;
    global.browser = undefined;
    logging = console; // eslint-disable-line no-global-assign
    return (cmd, data, realm, node) => {
      if (process.env.DEBUG) console.info('[bridge.guest.content] received', { cmd, data, node });
      bridge.onHandle({ cmd, data, node });
    };
  }
}

addHandlers({
  Command({ id, key, evt }) {
    commands[id]?.[key]?.cb(
      new (evt.key ? SafeKeyboardEvent : SafeMouseEvent)(
        evt.type, evt
      )
    );
  },
  /** @this {Node} */
  Callback({ id, data }) {
    if (id === 'Error') throw data;
    const fn = callbacks[id];
    delete callbacks[id];
    if (fn) this::fn(data);
  },
  GetGrantless() {
    bridge.post('SetGrantless', grantlessUsage);
  },
  async Plant({ data: dataKey, win: winKey }) {
    setOwnProp(window, winKey, onCodeSet, true, 'set');
    /* Cleaning up for a script that didn't compile at all due to a syntax error.
     * Note that winKey can be intercepted via MutationEvent in this case. */
    await 0;
    delete toRun[dataKey];
    delete window[winKey];
  },
  /**
   * @param {VMInjection.Info} info
   * @param {VMInjection.Script[]} items
   */
  ScriptData({ info, items }) {
    if (info) {
      assign(bridge, info);
    }
    const toRunNow = [];
    for (const script of items) {
      const { key } = script;
      toRun[key.data] = script;
      toRunById[script.id] = script;
      displayNames[script.id] = script.displayName;
      storages[script.id] = setPrototypeOf(script[VALUES] || {}, null);
      if (!PAGE_MODE_HANDSHAKE) {
        let hadData;
        if (!script.meta.unwrap) {
          const winKey = key.win;
          const data = window[winKey];
          if (data) { // executeScript ran before GetInjected response
            hadData = true;
            safePush(toRunNow, data);
            delete window[winKey];
          } else {
            defineProperty(window, winKey, {
              __proto__: null,
              configurable: true,
              set: onCodeSet,
            });
          }
        }
        if (script.code && !hadData) {
          runContentScriptBootstrap(script);
        }
      }
    }
    if (!PAGE_MODE_HANDSHAKE) toRunNow::forEach(onCodeSet);
    else if (IS_FIREFOX) bridge.post('InjectList', items[0][RUN_AT]);
  },
  Expose(allowGetScriptVer) {
    const key = 'external';
    const obj = window[key];
    (isObject(obj) ? obj : (window[key] = {}))[VIOLENTMONKEY] = {
      version: process.env.VM_VER,
      isInstalled: (name, namespace) => (
        allowGetScriptVer
          ? bridge.promise('GetScriptVer', { meta: { name, namespace } })
          : promiseResolve()
      ),
    };
  },
});

function onScriptEnteredFromWrapper(scriptId) {
  notifyScriptEntered(toRunById[scriptId]);
}

function notifyScriptEntered(item, signal = 'SCRIPT_ENTERED') {
  const id = item?.id;
  if (!id || startedScripts[id]) return;
  startedScripts[id] = 1;
  bridge.post('ScriptEntered', {
    id,
    injectInto: item[INJECT_INTO],
    runAt: item[RUN_AT],
    bridgeReady: !!bridge.post,
    signal,
  });
}

function runContentScriptBootstrap(item) {
  const code = item?.code;
  if (!code) return;
  try {
    // MV3 content-realm execution path avoids page-DOM script injection under strict CSP.
    // eslint-disable-next-line no-new-func
    Function(code)();
    if (item.meta.unwrap) {
      notifyScriptEntered(item, 'SCRIPT_ENTERED_UNWRAP');
      cleanupScript(item);
    }
  } catch (error) {
    const fallbackDispatched = isEvalBlockedByCsp(error)
      && dispatchContentEvalFallback(item, error);
    if (!fallbackDispatched && !error?.__vmBootstrapReported) {
      reportScriptFailedToStart(item, error, 'wrapper-construction');
      cleanupScript(item);
    } else if (fallbackDispatched) {
      scheduleFallbackPlantPoll(item);
      // Keep the setter/payload alive briefly so background-side fallback can trigger it.
      scheduleFallbackCleanup(item);
    }
  } finally {
    item.code = '';
  }
}

function isEvalBlockedByCsp(error) {
  const message = `${error?.message || error || ''}`;
  return error?.name === 'EvalError'
    && EVAL_BLOCKED_CSP_RE.test(message);
}

function dispatchContentEvalFallback(item, error) {
  const id = item?.id;
  const dataKey = item?.key?.data;
  if (!id || !dataKey || startedScripts[id] || item._vmEvalFallbackDispatched) return false;
  item._vmEvalFallbackDispatched = 1;
  bridge.post('ContentEvalBlocked', {
    scriptId: id,
    scriptName: item.displayName || displayNames[id] || '',
    runAt: item?.[RUN_AT] || '',
    injectInto: item?.[INJECT_INTO] || '',
    dataKey,
    reason: 'unsafe-eval-blocked',
    message: `${error?.message || error || ''}`.slice(0, 1200),
    pageUrl: location.href,
  });
  return true;
}

function scheduleFallbackCleanup(item, delayMs = FALLBACK_CLEANUP_DELAY_MS) {
  const id = item?.id;
  if (!id) return;
  setTimeout(() => {
    if (startedScripts[id]) return;
    reportScriptFailedToStart(item, null, 'fallback-timeout', {
      reason: 'Content eval fallback did not hand off script payload before timeout.',
    });
    cleanupScript(item);
  }, delayMs);
}

function scheduleFallbackPlantPoll(item, pollMs = FALLBACK_POLL_MS, maxWaitMs = FALLBACK_MAX_WAIT_MS) {
  const id = item?.id;
  const winKey = item?.key?.win;
  if (!id || !winKey) return;
  const startedAt = Date.now();
  const poll = () => {
    if (startedScripts[id] || !toRunById[id]) return;
    let planted;
    try {
      planted = window[winKey];
    } catch (e) {
      return;
    }
    if (isFunction(planted)) {
      onCodeSet(planted);
      return;
    }
    if (Date.now() - startedAt < maxWaitMs) {
      setTimeout(poll, pollMs);
    }
  };
  setTimeout(poll, pollMs);
}

function reportScriptFailedToStart(item, error, checkPhase, extra = createNullObj()) {
  const scriptId = item?.id || 0;
  bridge.post('ScriptFailedToStart', {
    scriptId,
    scriptName: item?.displayName || displayNames[scriptId] || '',
    runAt: item?.[RUN_AT] || extra.runAt || '',
    injectInto: item?.[INJECT_INTO] || extra.injectInto || '',
    realm: bridge.mode,
    state: ID_INJECTING,
    phase: 'script-failed-to-start',
    checkPhase,
    reason: extra.reason || 'SCRIPT_FAILED_TO_START',
    bridgeReady: !!bridge.post,
    pageUrl: location.href,
    fingerprint: [scriptId || 'unknown', checkPhase, location.href].filter(Boolean).join('|'),
    bootstrapError: {
      name: `${error?.name || ''}`,
      message: `${error?.message || error || extra.message || ''}`,
      stack: `${error?.stack || ''}`.slice(0, 4000),
      ...extra.runKey && { runKey: extra.runKey },
    },
  });
}

function cleanupScript(item) {
  if (!item) return;
  delete toRun[item.key.data];
  delete toRunById[item.id];
  delete window[item.key.win];
}

function onCodeSet(fn) {
  const runKey = fn?.name;
  const item = runKey && toRun[runKey];
  const el = document::getCurrentScript();
  if (!item) {
    reportScriptFailedToStart(null, null, 'missing-script-payload', {
      reason: `Bootstrap failed: no script payload found for key "${runKey || '<anonymous>'}".`,
      runKey,
    });
    if (el) el::remove();
    return;
  }
  try {
    const { gm, wrapper = global, grantless } = makeGmApiWrapper(item);
    if (grantless) grantlessUsage[item.id] = grantless;
    // Deleting now to prevent interception via DOMNodeRemoved on el::remove()
    delete window[item.key.win];
    if (process.env.DEBUG) {
      log('info', [bridge.mode], item.displayName);
    }
    if (el) {
      el::remove();
    }
    notifyScriptEntered(item, item._vmEvalFallbackDispatched
      ? 'SCRIPT_ENTERED_FALLBACK_ONCODESET'
      : 'SCRIPT_ENTERED_ONCODESET');
    wrapper::fn(gm, logging.error);
    cleanupScript(item);
  } catch (error) {
    reportScriptFailedToStart(item, error, 'pre-run-exception', {
      reason: 'Bootstrap exception thrown before startup completion.',
    });
    if (error && isObject(error)) {
      error.__vmBootstrapReported = 1;
    }
    cleanupScript(item);
    throw error;
  }
}
