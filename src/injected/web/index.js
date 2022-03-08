import bridge from './bridge';
import store from './store';
import { makeGmApiWrapper } from './gm-api-wrapper';
import './gm-values';
import './notifications';
import './requests';
import './tabs';
import { bindEvents, INJECT_PAGE, INJECT_CONTENT } from '../util';

// Make sure to call safe::methods() in code that may run after userscripts

const sendSetTimeout = () => bridge.send('SetTimeout', 0);
// Waiting for injection of content mode scripts that don't run on document-start
let resolvers;
let waiters;

export default function initialize(
  webId,
  contentId,
  invokeHost,
) {
  let invokeGuest;
  if (process.env.HANDSHAKE_ID) {
    window::on(process.env.HANDSHAKE_ID + process.env.HANDSHAKE_ACK, e => {
      e = e::getDetail();
      webId = e[0];
      contentId = e[1];
    }, { __proto__: null, once: true, capture: true });
    window::fire(new SafeCustomEvent(process.env.HANDSHAKE_ID));
  }
  bridge.dataKey = contentId;
  if (invokeHost) {
    resolvers = createNullObj();
    waiters = createNullObj();
    bridge.mode = INJECT_CONTENT;
    bridge.post = (cmd, data, context, node) => {
      invokeHost({ cmd, data, node, dataKey: (context || bridge).dataKey }, INJECT_CONTENT);
    };
    invokeGuest = (cmd, data, realm, node) => {
      if (process.env.DEBUG) console.info('[bridge.guest.content] received', { cmd, data, node });
      bridge.onHandle({ cmd, data, node });
    };
    global.chrome = undefined;
    global.browser = undefined;
    bridge.addHandlers({
      RunAt: name => resolvers[name](),
    });
  } else {
    bridge.mode = INJECT_PAGE;
    bindEvents(webId, contentId, bridge);
    bridge.addHandlers({
      /** @this {Node} contentWindow */
      WriteVault(id) {
        this[id] = VAULT;
      },
    });
  }
  return invokeGuest;
}

bridge.addHandlers({
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
      if (waiters && runAt !== 'start') {
        waiters[runAt] = new SafePromise(resolve => { resolvers[runAt] = resolve; });
      }
      items::forEach(createScriptData);
      // FF bug workaround to enable processing of sourceURL in injected page scripts
      if (IS_FIREFOX && bridge.mode === INJECT_PAGE) {
        bridge.post('InjectList', runAt);
      }
    }
  },
  Expose() {
    window.external.Violentmonkey = {
      version: process.env.VM_VER,
      isInstalled: (name, namespace) => (
        bridge.send('GetScriptVer', { meta: { name, namespace } })
      ),
    };
  },
});

function createScriptData(item) {
  const { dataKey } = item;
  store.values[item.props.id] = item.values || createNullObj();
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
  const { dataKey, stage } = item;
  // deleting now to prevent interception via DOMNodeRemoved on el::remove()
  delete window[dataKey];
  if (process.env.DEBUG) {
    log('info', [bridge.mode], item.displayName);
  }
  const run = () => {
    bridge.post('Run', item.props.id, item);
    const wrapper = makeGmApiWrapper(item);
    const thisArg = item.meta.grant.length ? wrapper : global;
    thisArg::fn(wrapper, logging.error);
  };
  const el = document::getCurrentScript();
  const wait = waiters?.[stage];
  if (el) el::remove();
  if (wait) {
    waiters[stage] = (stage === 'idle' ? wait::then(sendSetTimeout) : wait)::then(run);
  } else {
    run();
  }
}
