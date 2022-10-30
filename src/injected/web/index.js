import bridge, { addHandlers } from './bridge';
import store from './store';
import { makeGmApiWrapper } from './gm-api-wrapper';
import './gm-values';
import './notifications';
import './requests';
import './tabs';
import { bindEvents, INJECT_PAGE, INJECT_CONTENT } from '../util';

// Make sure to call safe::methods() in code that may run after userscripts

/** document-body scripts in content mode are inserted via executeScript at document-start
 * in inert state, then wait for content bridge to call RunAt('body'). */
let runAtBodyQueue;

export default function initialize(
  webId,
  contentId,
  invokeHost,
) {
  let invokeGuest;
  if (PAGE_MODE_HANDSHAKE) {
    window::on(PAGE_MODE_HANDSHAKE + '*', e => {
      e = e::getDetail();
      webId = e[0];
      contentId = e[1];
    }, { __proto__: null, once: true, capture: true });
    window::fire(new SafeCustomEvent(PAGE_MODE_HANDSHAKE));
  }
  if (invokeHost) {
    bridge.mode = INJECT_CONTENT;
    bridge.post = (cmd, data, realm, node) => {
      invokeHost({ cmd, data, node }, INJECT_CONTENT);
    };
    invokeGuest = (cmd, data, realm, node) => {
      if (process.env.DEBUG) console.info('[bridge.guest.content] received', { cmd, data, node });
      bridge.onHandle({ cmd, data, node });
    };
    global.chrome = undefined;
    global.browser = undefined;
    addHandlers({
      RunAt() {
        // executeScript code may run after <body> appeared
        if (runAtBodyQueue) {
          for (const fn of runAtBodyQueue) fn();
        }
        // allowing the belated code to run immediately
        runAtBodyQueue = false;
      },
    });
  } else {
    bridge.mode = INJECT_PAGE;
    bindEvents(webId, contentId, bridge);
    addHandlers({
      /** @this {Node} contentWindow */
      WriteVault(id) {
        this[id] = VAULT;
      },
    });
  }
  return invokeGuest;
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
  ScriptData({ info, items, runAt }) {
    if (info) {
      assign(bridge, info);
    }
    if (items) {
      items::forEach(createScriptData);
      // FF bug workaround to enable processing of sourceURL in injected page scripts
      if (IS_FIREFOX && PAGE_MODE_HANDSHAKE) {
        bridge.post('InjectList', runAt);
      }
    }
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

function createScriptData(item) {
  const { dataKey } = item;
  store.values[item.props.id] = nullObjFrom(item.values);
  if (window[dataKey]) { // executeScript ran before GetInjected response
    onCodeSet(item, window[dataKey]);
  } else if (!item.meta.unwrap) {
    safeDefineProperty(window, dataKey, {
      configurable: true,
      set: fn => onCodeSet(item, fn),
    });
  }
}

async function onCodeSet(item, fn) {
  const { dataKey } = item;
  // deleting now to prevent interception via DOMNodeRemoved on el::remove()
  delete window[dataKey];
  if (process.env.DEBUG) {
    log('info', [bridge.mode], item.displayName);
  }
  const run = () => {
    bridge.post('Run', item.props.id);
    const { gm, wrapper } = makeGmApiWrapper(item);
    (wrapper || global)::fn(gm, logging.error);
  };
  const el = document::getCurrentScript();
  if (el) {
    el::remove();
  }
  if (!PAGE_MODE_HANDSHAKE && runAtBodyQueue !== false && item.runAt === 'body') {
    safePush(runAtBodyQueue || (runAtBodyQueue = []), run);
  } else {
    run();
  }
}
