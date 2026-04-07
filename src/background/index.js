import '@/common/browser';
import { getActiveTab, makePause } from '@/common';
import { deepCopy } from '@/common/object';
import { handleHotkeyOrMenu } from './utils/icon';
import { addPublicCommands, commands, init } from './utils';
import './sync';
import './utils/clipboard';
import './utils/cookies';
import './utils/notifications';
import './utils/preinject';
import './utils/script';
import './utils/storage-fetch';
import './utils/tab-redirector';
import './utils/tester';
import './utils/update';

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

function handleCommandMessage({ cmd, data, url, [kTop]: mode } = {}, src) {
  if (init) {
    return init.then(handleCommandMessage.bind(this, ...arguments));
  }
  const func = hasOwnProperty(commands, cmd) && commands[cmd];
  if (!func) return; // not responding to commands for popup/options
  // The `src` is omitted when invoked via sendCmdDirectly unless fakeSrc is set.
  // The `origin` is Chrome-only, it can't be spoofed by a compromised tab unlike `url`.
  if (src) {
    let safeSrc;
    let safeUrl = url;
    try {
      safeUrl ||= src.url;
      safeSrc = {
        tab: src.tab && { ...src.tab },
        url: safeUrl,
        origin: src.origin,
        fake: src.fake,
        [kFrameId]: src[kFrameId],
        [kDocumentId]: src[kDocumentId],
        [kTop]: src[kTop],
      };
    } catch {
      safeSrc = { url: safeUrl };
    }
    let me = safeSrc.origin;
    me = me ? me === extensionOrigin : `${safeUrl || ''}`.startsWith(extensionRoot);
    if (!me && func.isOwn && !safeSrc.fake) {
      throw new SafeError(`Command is only allowed in extension context: ${cmd}`);
    }
    // TODO: revisit when link-preview is shipped in Chrome to fix tabId-dependent functionality
    if (!safeSrc.tab) {
      if (!me && (IS_FIREFOX ? !func.isOwn : !mode)) {
        if (process.env.DEBUG) console.log('No src.tab, ignoring:', ...arguments);
        return;
      }
      safeSrc.tab = false; // allowing access to props
    }
    if (mode) safeSrc[kTop] = mode;
    src = safeSrc;
  }
  return handleCommandMessageAsync(func, data, src);
}

async function handleCommandMessageAsync(func, data, src) {
  try {
    // `await` is necessary to catch the error here
    return await func(data, src);
  } catch (err) {
    if (process.env.DEBUG) console.error(err);
    // Adding `stack` info + in FF a rejected Promise value is transferred only for an Error object
    throw err instanceof SafeError ? err
      : new SafeError(isObject(err) ? JSON.stringify(err) : err);
  }
}

window._bg = 1;
global['handle' + 'CommandMessage' /* hiding the global from IDE */] = handleCommandMessage;
global['deep' + 'Copy' /* hiding the global from IDE */] = deepCopy;
browser.runtime.onMessage.addListener(handleCommandMessage);
browser.commands?.onCommand.addListener(async cmd => {
  handleHotkeyOrMenu(cmd, await getActiveTab());
});
