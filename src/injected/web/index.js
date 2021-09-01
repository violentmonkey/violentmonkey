import { INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import { assign, defineProperty, describeProperty } from '#/common/object';
import { bindEvents } from '../utils';
import { document, forEach, log, logging, remove, Promise, then } from '../utils/helpers';
import bridge from './bridge';
import { wrapGM } from './gm-wrapper';
import store from './store';
import './gm-values';
import './notifications';
import './requests';
import './tabs';

// Make sure to call safe::methods() in code that may run after userscripts

const { window } = global;
const { KeyboardEvent, MouseEvent } = global;
const { get: getCurrentScript } = describeProperty(Document.prototype, 'currentScript');

const sendSetTimeout = () => bridge.send('SetTimeout', 0);
const resolvers = {};
const waiters = {};

export default function initialize(
  webId,
  contentId,
  invokeHost,
) {
  let invokeGuest;
  if (invokeHost) {
    bridge.mode = INJECT_CONTENT;
    bridge.post = (cmd, data) => invokeHost({ cmd, data }, INJECT_CONTENT);
    invokeGuest = (cmd, data) => bridge.onHandle({ cmd, data });
    global.chrome = undefined;
    global.browser = undefined;
    bridge.addHandlers({
      RunAt: name => resolvers[name](),
    });
  } else {
    bridge.mode = INJECT_PAGE;
    bridge.post = bindEvents(webId, contentId, bridge.onHandle);
    bridge.addHandlers({
      Ping() {
        bridge.post('Pong');
      },
    });
  }
  return invokeGuest;
}

bridge.addHandlers({
  Command([cmd, evt]) {
    const constructor = evt.key ? KeyboardEvent : MouseEvent;
    store.commands[cmd]?.(new constructor(evt.type, evt));
  },
  Callback({ callbackId, payload }) {
    bridge.callbacks[callbackId]?.(payload);
  },
  ScriptData({ info, items, runAt }) {
    if (info) {
      assign(info.cache, bridge.cache);
      assign(bridge, info);
    }
    if (items) {
      const { stage } = items[0];
      if (stage) waiters[stage] = new Promise(resolve => { resolvers[stage] = resolve; });
      items::forEach(createScriptData);
      // FF bug workaround to enable processing of sourceURL in injected page scripts
      if (bridge.isFirefox && bridge.mode === INJECT_PAGE) {
        bridge.post('InjectList', runAt);
      }
    }
  },
  Expose() {
    const Violentmonkey = {};
    defineProperty(Violentmonkey, 'version', {
      value: process.env.VM_VER,
    });
    defineProperty(Violentmonkey, 'isInstalled', {
      async value(name, namespace) {
        const script = await bridge.send('GetScript', { meta: { name, namespace } });
        return script && !script.config.removed ? script.meta.version : null;
      },
    });
    defineProperty(window.external, 'Violentmonkey', {
      value: Violentmonkey,
    });
  },
});

function createScriptData(item) {
  const { dataKey } = item;
  store.values[item.props.id] = item.values || {};
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
    wrapGM(item)::fn(logging.error);
    bridge.post('Run', item.props.id);
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
