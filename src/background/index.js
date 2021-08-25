import '#/common/browser';
import { getActiveTab, makePause, sendCmd } from '#/common';
import { TIMEOUT_24HOURS, TIMEOUT_MAX } from '#/common/consts';
import { deepCopy } from '#/common/object';
import * as tld from '#/common/tld';
import ua from '#/common/ua';
import * as sync from './sync';
import { commands } from './utils';
import { getData, checkRemove } from './utils/db';
import { initialize } from './utils/init';
import { getOption, hookOptions } from './utils/options';
import { popupTabs } from './utils/popup-tracker';
import { getInjectedScripts } from './utils/preinject';
import { SCRIPT_TEMPLATE, resetScriptTemplate } from './utils/template-hook';
import { resetValueOpener, addValueOpener } from './utils/values';
import { clearRequestsByTabId } from './utils/requests';
import './utils/clipboard';
import './utils/hotkeys';
import './utils/icon';
import './utils/notifications';
import './utils/script';
import './utils/tabs';
import './utils/tester';
import './utils/update';

hookOptions((changes) => {
  if ('autoUpdate' in changes) {
    autoUpdate();
  }
  if (SCRIPT_TEMPLATE in changes) {
    resetScriptTemplate(changes);
  }
  sendCmd('UpdateOptions', changes);
});

Object.assign(commands, {
  /** @return {Promise<{ scripts: VMScript[], cache: Object, sync: Object }>} */
  async GetData(ids) {
    const data = await getData(ids);
    data.sync = sync.getStates();
    return data;
  },
  /** @return {Promise<Object>} */
  async GetInjected(_, src) {
    const { frameId, url, tab: { id: tabId } } = src;
    if (!frameId) {
      resetValueOpener(tabId);
      clearRequestsByTabId(tabId);
    }
    const res = await getInjectedScripts(url, tabId, frameId);
    const { feedback, gmVal } = res._tmp;
    res.isPopupShown = popupTabs[tabId];
    // Injecting known content scripts without waiting for InjectionFeedback message.
    // Running in a separate task because it may take a long time to serialize data.
    if (feedback.length) {
      setTimeout(commands.InjectionFeedback, 0, { feedback }, src);
    }
    addValueOpener(tabId, frameId, gmVal);
    return res;
  },
  /** @return {Promise<Object>} */
  async GetTabDomain() {
    const tab = await getActiveTab() || {};
    const url = tab.pendingUrl || tab.url || '';
    const host = url.match(/^https?:\/\/([^/]+)|$/)[1];
    return {
      tab,
      domain: host && tld.getDomain(host) || host,
    };
  },
  /**
   * Timers in content scripts are shared with the web page so it can clear them.
   * await sendCmd('SetTimeout', 100) in injected/content
   * await bridge.send('SetTimeout', 100) in injected/web
   */
  SetTimeout(ms) {
    return ms > 0 && makePause(ms);
  },
});

// commands to sync unconditionally regardless of the returned value from the handler
const commandsToSync = [
  'MarkRemoved',
  'Move',
  'ParseScript',
  'RemoveScript',
  'UpdateScriptInfo',
];
// commands to sync only if the handler returns a truthy value
const commandsToSyncIfTruthy = [
  'CheckRemove',
  'CheckUpdate',
  'CheckUpdateAll',
];

async function handleCommandMessage(req, src) {
  const { cmd } = req;
  const res = await commands[cmd]?.(req.data, src);
  if (commandsToSync.includes(cmd)
  || res && commandsToSyncIfTruthy.includes(cmd)) {
    sync.sync();
  }
  // `undefined` is not transferable, but `null` is
  return res ?? null;
}

function autoUpdate() {
  const interval = (+getOption('autoUpdate') || 0) * TIMEOUT_24HOURS;
  if (!interval) return;
  let elapsed = Date.now() - getOption('lastUpdate');
  if (elapsed >= interval) {
    handleCommandMessage({ cmd: 'CheckUpdateAll' });
    elapsed = 0;
  }
  clearTimeout(autoUpdate.timer);
  autoUpdate.timer = setTimeout(autoUpdate, Math.min(TIMEOUT_MAX, interval - elapsed));
}

initialize(() => {
  global.handleCommandMessage = handleCommandMessage;
  global.deepCopy = deepCopy;
  browser.runtime.onMessage.addListener(
    ua.isFirefox // in FF a rejected Promise value is transferred only if it's an Error object
      ? (...args) => (
        handleCommandMessage(...args).catch(e => { throw e instanceof Error ? e : new Error(e); }))
      : handleCommandMessage,
  );
  setTimeout(autoUpdate, 2e4);
  sync.initialize();
  checkRemove();
  setInterval(checkRemove, TIMEOUT_24HOURS);
  if (ua.isChrome) {
    // Using declarativeContent to run content scripts earlier than document_start
    const api = global.chrome.declarativeContent;
    api.onPageChanged.getRules(['inject'], rules => {
      if (rules.length) return;
      api.onPageChanged.addRules([{
        id: 'inject',
        conditions: [
          new api.PageStateMatcher({
            pageUrl: { urlContains: '://' }, // essentially like <all_urls>
          }),
        ],
        actions: [
          new api.RequestContentScript({
            js: browser.runtime.getManifest().content_scripts[0].js,
            // Not using `allFrames:true` as there's no improvement in frames
          }),
        ],
      }]);
    });
  }
});
