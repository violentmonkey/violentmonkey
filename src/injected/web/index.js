import { INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import { bindEvents, createNullObj, log } from '../util';
import bridge from './bridge';
import store from './store';
import './gm-values';
import './notifications';
import './requests';
import './tabs';
import { makeGmApiWrapper } from './gm-wrapper';

// Make sure to call safe::methods() in code that may run after userscripts

const sendSetTimeout = () => bridge.send('SetTimeout', 0);
const resolvers = createNullObj();
const waiters = createNullObj();

export default function initialize(
  webId,
  contentId,
  invokeHost,
) {
  let invokeGuest;
  bridge.dataKey = contentId;
  if (invokeHost) {
    bridge.mode = INJECT_CONTENT;
    bridge.post = (cmd, data, context, node) => {
      invokeHost({ cmd, data, node, dataKey: (context || bridge).dataKey }, INJECT_CONTENT);
    };
    invokeGuest = (cmd, data, realm, node) => bridge.onHandle({ cmd, data, node });
    global.chrome = undefined;
    global.browser = undefined;
    bridge.addHandlers({
      RunAt: name => resolvers[name](),
    });
  } else {
    bridge.mode = INJECT_PAGE;
    bindEvents(webId, contentId, bridge);
    bridge.addHandlers({
      /** @this {Node} contentDocument */
      Frame(id) {
        this[id] = VAULT;
      },
      Ping() {
        bridge.post('Pong');
      },
    });
  }
  return invokeGuest;
}

bridge.addHandlers({
  __proto__: null,
  Command({ id, cap, evt }) {
    const constructor = evt.key ? KeyboardEventSafe : MouseEventSafe;
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
      info.cache = assign(createNullObj(), info.cache, bridge.cache);
      assign(bridge, info);
    }
    if (items) {
      const { stage } = items[0];
      if (stage) waiters[stage] = new PromiseSafe(resolve => { resolvers[stage] = resolve; });
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
  } else {
    defineProperty(window, dataKey, {
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
    makeGmApiWrapper(item)::fn(logging.error);
  };
  const el = document::getCurrentScript();
  const wait = waiters[stage];
  if (el) el::remove();
  if (wait) {
    waiters[stage] = (stage === 'idle' ? wait::then(sendSetTimeout) : wait)::then(run);
  } else {
    run();
  }
}
