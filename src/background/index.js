import { sendCmd, noop } from '#/common';
import { TIMEOUT_24HOURS, TIMEOUT_MAX } from '#/common/consts';
import ua from '#/common/ua';
import * as sync from './sync';
import { cache, commands } from './utils';
import { getData, checkRemove, getScriptsByURL } from './utils/db';
import { initialize } from './utils/init';
import { getOption, hookOptions } from './utils/options';
import { resetValueOpener, addValueOpener } from './utils/values';
import { SCRIPT_TEMPLATE, resetScriptTemplate } from './utils/template-hook';
import { PREINJECT_KEY, togglePreinject } from './utils/preinject';
import './utils/clipboard';
import './utils/hotkeys';
import './utils/icon';
import './utils/notifications';
import './utils/requests';
import './utils/script';
import './utils/tabs';
import './utils/tester';
import './utils/update';

const VM_VER = browser.runtime.getManifest().version;
let isApplied;
let injectInto;

hookOptions((changes) => {
  if ('autoUpdate' in changes) autoUpdate();
  if ('defaultInjectInto' in changes) injectInto = changes.defaultInjectInto;
  if ('isApplied' in changes) {
    isApplied = changes.isApplied;
    togglePreinject(isApplied);
  }
  if (SCRIPT_TEMPLATE in changes) resetScriptTemplate(changes);
  sendCmd('UpdateOptions', changes);
});

Object.assign(commands, {
  /** @return {Promise<Object>} */
  async GetData() {
    const data = await getData();
    data.sync = sync.getStates();
    data.version = VM_VER;
    return data;
  },
  /** @return {Promise<Object>} */
  async GetInjected(_, { url, tab, frameId }) {
    if (frameId === 0) resetValueOpener(tab.id);
    const data = {
      isApplied,
      injectInto,
      ua,
      isFirefox: ua.isFirefox,
      version: VM_VER,
    };
    if (isApplied) {
      const scripts = await (cache.get(`${PREINJECT_KEY}${url}`) || getScriptsByURL(url));
      addValueOpener(tab.id, frameId, Object.keys(scripts.values));
      Object.assign(data, scripts);
    }
    return data;
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
  injectInto = getOption('defaultInjectInto');
  isApplied = getOption('isApplied');
  togglePreinject(isApplied);
  setTimeout(autoUpdate, 2e4);
  sync.initialize();
  checkRemove();
  setInterval(checkRemove, TIMEOUT_24HOURS);
});
