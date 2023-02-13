import bridge, { addHandlers } from './bridge';
import store from './store';
import { makeGmApiWrapper } from './gm-api-wrapper';
import './gm-values';
import './notifications';
import './requests';
import './tabs';
import { bindEvents } from '../util';

// Make sure to call safe::methods() in code that may run after userscripts

const toRun = createNullObj();

export default function initialize(invokeHost) {
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
  } else {
    bridge.mode = CONTENT;
    bridge.post = (cmd, data, node) => {
      invokeHost({ cmd, data, node }, CONTENT);
    };
    global.chrome = undefined;
    global.browser = undefined;
    return (cmd, data, realm, node) => {
      if (process.env.DEBUG) console.info('[bridge.guest.content] received', { cmd, data, node });
      bridge.onHandle({ cmd, data, node });
    };
  }
}

addHandlers({
  Command({ id, cap, evt }) {
    const constructor = evt.key ? SafeKeyboardEvent : SafeMouseEvent;
    const fn = store.commands[`${id}:${cap}`];
    if (fn) fn(new constructor(evt.type, evt));
  },
  /** @this {Node} */
  Callback({ id, data }) {
    const fn = bridge.callbacks[id];
    delete bridge.callbacks[id];
    if (fn) this::fn(data);
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
      store[VALUES][script.id] = nullObjFrom(script[VALUES]);
      if (!PAGE_MODE_HANDSHAKE) {
        const winKey = key.win;
        const data = window[winKey];
        if (data) { // executeScript ran before GetInjected response
          safePush(toRunNow, data);
          delete window[winKey];
        } else {
          safeDefineProperty(window, winKey, {
            configurable: true,
            set: onCodeSet,
          });
        }
      }
    }
    if (!PAGE_MODE_HANDSHAKE) toRunNow::forEach(onCodeSet);
    else if (IS_FIREFOX) bridge.post('InjectList', items[0][RUN_AT]);
  },
  Expose() {
    external[VIOLENTMONKEY] = {
      version: process.env.VM_VER,
      isInstalled: (name, namespace) => (
        bridge.send('GetScriptVer', { meta: { name, namespace } })
      ),
    };
  },
});

function onCodeSet(fn) {
  const item = toRun[fn.name];
  const el = document::getCurrentScript();
  const { gm, wrapper = global } = makeGmApiWrapper(item);
  // Deleting now to prevent interception via DOMNodeRemoved on el::remove()
  delete window[item.key.win];
  if (process.env.DEBUG) {
    log('info', [bridge.mode], item.displayName);
  }
  if (el) {
    el::remove();
  }
  bridge.post('Run', item.id);
  wrapper::fn(gm, logging.error);
}
