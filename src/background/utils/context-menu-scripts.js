import {
  browserWindows, getActiveTab, getScriptName, getScriptRunAt, getTab, ignoreChromeErrors, noop,
  sendTabCmd,
} from '@/common';
import { tryBrowserListener } from '@/common/browser-listener';
import { FILE_GLOB_ALL, GLOB_ALL } from '@/common/consts';
import { getScriptById } from './db';
import { addOwnCommands, init } from './init';
import { getOption, hookOptions } from './options';
import { aliveScripts } from './script';
import { onStorageChanged } from './storage';
import { injectableRe, tabsOnActivated, tabsOnUpdated } from './tabs';
import { testBlacklist, testScript, testScriptContext } from './tester';

const contextMenus = chrome.contextMenus;
const PREFIX = 'run-script:';
const SESSION_KEY = 'contextMenuScriptIds';
let menuIds = [];
let sessionMenusReady;
let rebuildQueue = Promise.resolve();

addOwnCommands({ RunContextMenuScript: runContextMenuScript });

export async function runContextMenuScript({ id, tabId, frameId = 0, url }) {
  const tab = await getTab(tabId);
  const script = getScriptById(id);
  if (!tab || !canRun(script, url || tab.url, !frameId, tab)) return false;
  return sendTabCmd(tabId, 'RunContextMenuScript', +id, { [kFrameId]: frameId });
}

export function rebuildContextMenuScripts(tab) {
  const rebuild = () => rebuildMenus(tab);
  return (rebuildQueue = rebuildQueue.then(rebuild, rebuild).catch(noop));
}

async function rebuildMenus(tab) {
  if (!contextMenus?.create || !contextMenus.remove) return;
  if (!sessionMenusReady) {
    sessionMenusReady = true;
    try {
      if (__.MV3 && chrome.storage.session) {
        menuIds = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || [];
      }
    } catch {
      menuIds = [];
    }
  }
  for (const id of menuIds) contextMenus.remove(id, ignoreChromeErrors);
  menuIds = [];
  tab ||= await getActiveTab();
  for (const script of aliveScripts) {
    if (!tab || !canRun(script, tab.url, true, tab)) continue;
    const id = PREFIX + script.props.id;
    contextMenus.create({
      id,
      title: getScriptName(script).slice(0, 250),
      contexts: ['all'],
      documentUrlPatterns: [GLOB_ALL, FILE_GLOB_ALL],
    }, ignoreChromeErrors);
    menuIds.push(id);
  }
  try {
    if (__.MV3) await chrome.storage.session?.set({ [SESSION_KEY]: menuIds });
  } catch {
    return;
  }
}

function canRun(script, url, isTop, tab) {
  return !!(script?.config.enabled && !script.config.removed && getOption(IS_APPLIED)
    && getScriptRunAt(script) === 'context-menu'
    && (isTop || !(script.custom.noframes ?? script.meta.noframes))
    && injectableRe.test(url) && !testBlacklist(url)
    && testScriptContext(script, tab) && testScript(url, script));
}

if (contextMenus?.create) {
  init?.then(() => rebuildContextMenuScripts(), () => {});
  tryBrowserListener(contextMenus.onClicked, 'addListener', ({ menuItemId, frameId, frameUrl, pageUrl }, tab) => {
    if (typeof menuItemId === 'string' && menuItemId.startsWith(PREFIX)) {
      runContextMenuScript({
        id: +menuItemId.slice(PREFIX.length), tabId: tab.id, frameId, url: frameUrl || pageUrl,
      });
    }
  });
  tryBrowserListener(tabsOnActivated, 'addListener', ({ tabId }) => {
    getTab(tabId).then(rebuildContextMenuScripts);
  });
  tryBrowserListener(tabsOnUpdated, 'addListener', (tabId, change, tab) => {
    if (tab?.active && (change.url || change.status === 'complete')) {
      rebuildContextMenuScripts(tab);
    }
  });
  tryBrowserListener(browserWindows?.onFocusChanged, 'addListener', () => rebuildContextMenuScripts());
  onStorageChanged(keys => {
    if (keys.some(key => /^(?:scr|code):/.test(key))) rebuildContextMenuScripts();
  });
  hookOptions(changes => {
    if (IS_APPLIED in changes) rebuildContextMenuScripts();
  });
}
