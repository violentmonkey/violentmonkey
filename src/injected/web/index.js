import * as bridge from './bridge';
import { GM_API_CTX } from './gm-api';
import { makeGmApiWrapper } from './gm-api-wrapper';
import './gm-values';
import './notifications';
import './requests';
import './tabs';
import { addErrorStack, bindEvents, CONSOLE_METHODS } from '../util';
import { safeConcat } from './util';

// Make sure to call safe::methods() in code that may run after userscripts

const toRun = createNullObj();
const gmis = createNullObj();
const grantlessUsage = createNullObj();

/** Exported via banner added in webpack */// eslint-disable-next-line no-undef
VMInitInjection = (invokeHost, console) => {
  if (PAGE_MODE_HANDSHAKE) {
    window::on(PAGE_MODE_HANDSHAKE + '*', e => {
      e = e::getDetail();
      bridge.post = bindEvents(e[0], e[1], bridge.onHandle); // eslint-disable-line no-import-assign
    }, { __proto__: null, once: true, capture: true });
    window::fire(new SafeCustomEvent(PAGE_MODE_HANDSHAKE));
    bridge.mode = PAGE; // eslint-disable-line no-import-assign
    bridge.addHandlers({
      /** @this {Node} contentWindow */
      WriteVault(id) {
        this[id] = VAULT;
      },
    });
    /* Can't use a detached `console` in Chrome 109+ due to https://crrev.com/1063194 */
    if (__.MV3 || !IS_FIREFOX) {
      for (const m of CONSOLE_METHODS) {
        logging[m] = (...args) => bridge.post('Log', [m, args]);
      }
      /** @this {GMContext} */
      GM_API_CTX.GM_log = function (...args) {
        bridge.post('Log', ['log', safeConcat([`[${this.displayName}]`], args)]);
      };
    }
  } else {
    bridge.mode = CONTENT; // eslint-disable-line no-import-assign
    bridge.post = (cmd, data, node) => // eslint-disable-line no-import-assign
      invokeHost({ cmd, data, node }, CONTENT);
    global.browser = global.chrome = undefined;
    logging = console; // eslint-disable-line no-global-assign
    return (cmd, data, realm, node) => {
      if (__.DEBUG) console.info('[bridge.guest.content] received', { cmd, data, node });
      bridge.onHandle({ cmd, data, node });
    };
  }
};

bridge.addHandlers({
  Command({ id, key, evt }) {
    bridge.commands[id]?.[key]?.cb(
      new (evt.key ? SafeKeyboardEvent : SafeMouseEvent)(
        evt.type, evt
      )
    );
  },
  Callback({ id, res, err }) {
    const cb = bridge.callbacks[id];
    delete bridge.callbacks[id];
    if (cb) {
      if (err && cb[1]) addErrorStack(err, cb[1]);
      this::cb[0](res, err);
    } else if (err) {
      throw err;
    }
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
      assign(bridge.info, info);
    }
    const toRunNow = [];
    for (const script of items) {
      const { id, key } = script;
      toRun[key.data] = script;
      gmis[id] = script.gmi;
      bridge.displayNames[id] = script.displayName;
      bridge.storages[id] = setPrototypeOf(script[VALUES] || {}, null);
      if (!PAGE_MODE_HANDSHAKE) {
        const winKey = key.win;
        const data = window[winKey];
        if (data) { // executeScript ran before GetInjected response
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
    }
    if (!PAGE_MODE_HANDSHAKE) toRunNow::forEach(onCodeSet);
    else if (!__.MV3 && IS_FIREFOX) bridge.post('InjectList', items[0][RUN_AT]);
  },
  SetGMI(data) {
    assign(bridge.info.gmi, data);
    for (const id in gmis) try { assign(gmis[id], data); } catch {/*ignore possible setters*/}
  },
  Expose(allowGetScriptVer) {
    const key = 'external';
    const obj = window[key];
    (isObject(obj) ? obj : (window[key] = {}))[VIOLENTMONKEY] = {
      version: __.VM_VER,
      isInstalled: (name, namespace) => (
        allowGetScriptVer
          ? bridge.promise('GetScriptVer', { meta: { name, namespace } })
          : promiseResolve()
      ),
    };
  },
});

function onCodeSet(fn) {
  const item = toRun[fn.name];
  const el = document::getCurrentScript();
  const { gm, wrapper = global, grantless } = makeGmApiWrapper(item);
  if (grantless) grantlessUsage[item.id] = grantless;
  // Deleting now to prevent interception via DOMNodeRemoved on el::remove()
  delete window[item.key.win];
  if (__.DEBUG) {
    log('info', [bridge.mode], item.displayName);
  }
  if (el) {
    el::remove();
  }
  bridge.post('Run', item.id);
  wrapper::fn(gm, logging.error);
}
