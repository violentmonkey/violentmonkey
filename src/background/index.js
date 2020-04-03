import { sendCmd } from '#/common';
import { TIMEOUT_24HOURS, TIMEOUT_MAX } from '#/common/consts';
import ua from '#/common/ua';
import * as sync from './sync';
import { commands } from './utils';
import cache from './utils/cache';
import { getData, checkRemove } from './utils/db';
import { setBadge } from './utils/icon';
import { initialize } from './utils/init';
import { getOption, hookOptions } from './utils/options';
import { getInjectedScripts } from './utils/preinject';
import { SCRIPT_TEMPLATE, resetScriptTemplate } from './utils/template-hook';
import { resetValueOpener, addValueOpener } from './utils/values';
import './utils/clipboard';
import './utils/hotkeys';
import './utils/notifications';
import './utils/requests';
import './utils/script';
import './utils/tabs';
import './utils/tester';
import './utils/update';

let isApplied;

hookOptions((changes) => {
  if ('autoUpdate' in changes) autoUpdate();
  if ('isApplied' in changes) isApplied = changes.isApplied;
  if (SCRIPT_TEMPLATE in changes) resetScriptTemplate(changes);
  sendCmd('UpdateOptions', changes);
});

Object.assign(commands, {
  /** @return {Promise<Object>} */
  async GetData() {
    const data = await getData();
    data.sync = sync.getStates();
    return data;
  },
  /** @return {Promise<Object>} */
  async GetInjected(_, src) {
    const { frameId, tab, url } = src;
    if (!frameId) resetValueOpener(tab.id);
    const res = {};
    if (isApplied) {
      const data = await getInjectedScripts(url, tab.id, frameId);
      addValueOpener(tab.id, frameId, data.withValueIds);
      setBadge(data.enabledIds, src);
      Object.assign(res, data.inject);
      data.registration?.then(r => r.unregister());
      // Injecting known content mode scripts without waiting for InjectionFeedback
      const inContent = res.scripts.map(s => !s.code && [s.dataKey, true]).filter(Boolean);
      if (inContent.length) {
        // executeScript is slow (in FF at least) so this will run after the response is sent
        Promise.resolve().then(() => commands.InjectionFeedback(inContent, src));
      }
    }
    return res;
  },
  InjectionFeedback(feedback, { tab, frameId }) {
    feedback.forEach(([key, needsInjection]) => {
      const code = cache.pop(key);
      // see TIME_KEEP_DATA comment
      if (needsInjection && code) {
        browser.tabs.executeScript(tab.id, {
          code,
          frameId,
          runAt: 'document_start',
        });
      }
    });
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
  browser.runtime.onMessage.addListener(handleCommandMessage);
  isApplied = getOption('isApplied');
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
