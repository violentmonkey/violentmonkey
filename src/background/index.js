import '@/common/browser';
import { makePause } from '@/common';
import { deepCopy } from '@/common/object';
import { getDomain } from '@/common/tld';
import { addOwnCommands, addPublicCommands, commands, init } from './utils';
import './sync';
import './utils/clipboard';
import './utils/hotkeys';
import './utils/icon';
import './utils/notifications';
import './utils/preinject';
import './utils/script';
import './utils/storage-fetch';
import './utils/tab-redirector';
import './utils/tester';
import './utils/update';

addOwnCommands({
  /**
   * @param {string?} url
   * @return {Promise<Object>}
   */
  async GetTabDomain(url) {
    const host = url && new URL(url).hostname;
    return {
      host,
      domain: host && getDomain(host) || host,
    };
  },
});

addPublicCommands({
  /**
   * Timers in content scripts are shared with the web page so it can clear them.
   * await sendCmd('SetTimeout', 100) in injected/content
   * bridge.call('SetTimeout', 100, cb) in injected/web
   */
  SetTimeout(ms) {
    return ms > 0 && makePause(ms);
  },
});

async function handleCommandMessage({ cmd, data, [kTop]: mode } = {}, src) {
  if (init) {
    return init.then(handleCommandMessage.bind(this, ...arguments));
  }
  const func = hasOwnProperty(commands, cmd) && commands[cmd];
  if (!func) {
    throw new SafeError(`Unknown command: ${cmd}`);
  }
  // The `src` is omitted when invoked via sendCmdDirectly unless fakeSrc is set.
  // The `origin` is Chrome-only, it can't be spoofed by a compromised tab unlike `url`.
  if (func.isOwn && src && !src.fake
  && (src.origin ? src.origin !== extensionOrigin : !`${src.url}`.startsWith(extensionRoot))) {
    throw new SafeError(`Command is only allowed in extension context: ${cmd}`);
  }
  if (IS_FIREFOX && !func.isOwn && src && !src.tab && !src.url.startsWith(extensionRoot)) {
    if (process.env.DEBUG) console.log('No src.tab, ignoring:', ...arguments);
    return;
  }
  if (mode && src) {
    src[kTop] = mode;
  }
  try {
    // `await` is necessary to catch the error here
    const res = await func(data, src);
    // `undefined` is not transferable, but `null` is
    return res ?? null;
  } catch (err) {
    if (process.env.DEBUG) console.error(err);
    // Adding `stack` info + in FF a rejected Promise value is transferred only for an Error object
    throw err instanceof SafeError ? err
      : new SafeError(isObject(err) ? JSON.stringify(err) : err);
  }
}

global.handleCommandMessage = handleCommandMessage;
global.deepCopy = deepCopy;
browser.runtime.onMessage.addListener(handleCommandMessage);
