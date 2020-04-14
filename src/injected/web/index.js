import { INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import { defineProperty, describeProperty } from '#/common/object';
import { bindEvents } from '../utils';
import { forEach, log, remove, Promise } from '../utils/helpers';
import bridge from './bridge';
import { wrapGmAndRun } from './gm-wrapper';
import store from './store';
import './gm-values';
import './notifications';
import './requests';
import './tabs';

// Make sure to call safe::methods() in code that may run after userscripts

const { document } = global;
const { get: getCurrentScript } = describeProperty(Document.prototype, 'currentScript');

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
  } else {
    bridge.mode = INJECT_PAGE;
    bridge.post = bindEvents(webId, contentId, bridge.onHandle);
    bridge.addHandlers({
      Ping() {
        bridge.post('Pong');
      },
    });
  }
  bridge.load = new Promise(resolve => {
    // waiting for the page handlers to run first
    bridge.loadResolve = async () => await 1 && resolve(1);
    document.addEventListener('DOMContentLoaded', bridge.loadResolve, { once: true });
  });
  return invokeGuest;
}

bridge.addHandlers({
  Command(data) {
    store.commands[data]?.();
  },
  Callback({ callbackId, payload }) {
    bridge.callbacks[callbackId]?.(payload);
  },
  ScriptData({ info, items, runAt }) {
    if (info) {
      bridge.isFirefox = info.isFirefox;
      bridge.ua = info.ua;
      store.cache = info.cache;
    }
    if (items) {
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
      value: (name, namespace) => bridge.send('CheckScript', { name, namespace }),
    });
    defineProperty(window.external, 'Violentmonkey', {
      value: Violentmonkey,
    });
  },
});

function createScriptData(item) {
  const { dataKey, values } = item;
  store.values[item.props.id] = values;
  if (window[dataKey]) {
    // executeScript ran earlier than GetInjected response (improbable but theoretically possible)
    onCodeSet(item, window[dataKey]);
  } else {
    defineProperty(window, dataKey, {
      configurable: true,
      set: fn => onCodeSet(item, fn),
    });
  }
}

async function onCodeSet(item, fn) {
  // deleting now to prevent interception via DOMNodeRemoved on el::remove()
  delete window[item.dataKey];
  if (process.env.DEBUG) {
    log('info', [bridge.mode], item.custom.name || item.meta.name || item.props.id);
  }
  const el = document::getCurrentScript();
  if (el) el::remove();
  if (item.action === 'wait') {
    await bridge.load;
  }
  wrapGmAndRun(item, fn);
}
