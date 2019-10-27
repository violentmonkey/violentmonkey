import { noop, getUniqId } from '#/common';
import { objectGet } from '#/common/object';
import * as sync from './sync';
import {
  cache,
  getRequestId, httpRequest, abortRequest, confirmInstall,
  newScript, parseMeta,
  setClipboard, checkUpdate,
  getOption, setOption, hookOptions, getAllOptions,
  initialize, sendMessageOrIgnore,
} from './utils';
import { tabOpen, tabClose } from './utils/tabs';
import createNotification from './utils/notifications';
import {
  getScripts, markRemoved, removeScript, getData, checkRemove, getScriptsByURL,
  updateScriptInfo, getExportData, getScriptCode,
  getScriptByIds, moveScript, vacuum, parseScript, getScript,
  sortScripts, getValueStoresByIds,
} from './utils/db';
import { resetBlacklist, testBlacklist } from './utils/tester';
import {
  setValueStore, updateValueStore, resetValueOpener, addValueOpener,
} from './utils/values';
import { setBadge } from './utils/icon';
import { SCRIPT_TEMPLATE, resetScriptTemplate } from './utils/template-hook';
import './utils/commands';

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
  sendMessageOrIgnore({
    cmd: 'UpdateOptions',
    data: changes,
  });
});

function checkUpdateAll() {
  setOption('lastUpdate', Date.now());
  getScripts()
  .then((scripts) => {
    const toUpdate = scripts.filter(item => objectGet(item, 'config.shouldUpdate'));
    return Promise.all(toUpdate.map(checkUpdate));
  })
  .then((updatedList) => {
    if (updatedList.some(Boolean)) sync.sync();
  });
}

let autoUpdating;
function autoUpdate() {
  if (autoUpdating) return;
  autoUpdating = true;
  check();
  function check() {
    new Promise((resolve, reject) => {
      if (!getOption('autoUpdate')) return reject();
      if (Date.now() - getOption('lastUpdate') >= 864e5) resolve(checkUpdateAll());
    })
    .then(() => setTimeout(check, 36e5), () => { autoUpdating = false; });
  }
}

function autoCheckRemove() {
  checkRemove();
  setTimeout(autoCheckRemove, 24 * 60 * 60 * 1000);
}

const commands = {
  NewScript(id) {
    return id && cache.get(`new-${id}`) || newScript();
  },
  CacheNewScript(data) {
    const id = getUniqId();
    cache.put(`new-${id}`, newScript(data));
    return id;
  },
  MarkRemoved({ id, removed }) {
    return markRemoved(id, removed)
    .then(() => { sync.sync(); });
  },
  RemoveScript(id) {
    return removeScript(id)
    .then(() => { sync.sync(); });
  },
  GetData() {
    return getData()
    .then((data) => {
      data.sync = sync.getStates();
      data.version = VM_VER;
      return data;
    });
  },
  async GetInjected({ url, reset }, src) {
    const { id: tabId } = src.tab || {};
    if (reset && tabId >= 0) resetValueOpener(tabId);
    const data = {
      isApplied,
      injectInto,
      version: VM_VER,
    };
    if (isApplied) {
      const scripts = await (cache.get(`preinject:${url}`) || getScriptsByURL(url));
      addValueOpener(tabId, Object.keys(scripts.values));
      Object.assign(data, scripts);
    }
    return data;
  },
  UpdateScriptInfo({ id, config }) {
    return updateScriptInfo(id, {
      config,
      props: {
        lastModified: Date.now(),
      },
    })
    .then(() => { sync.sync(); });
  },
  GetValueStore(id) {
    return getValueStoresByIds([id]).then(res => res[id] || {});
  },
  SetValueStore({ where, valueStore }) {
    // Value store will be replaced soon.
    return setValueStore(where, valueStore);
  },
  UpdateValue({ id, update }) {
    // Value will be updated to store later.
    return updateValueStore(id, update);
  },
  ExportZip({ values }) {
    return getExportData(values);
  },
  GetScriptCode(id) {
    return getScriptCode(id);
  },
  GetMetas(ids) {
    return getScriptByIds(ids);
  },
  Move({ id, offset }) {
    return moveScript(id, offset)
    .then(() => {
      sync.sync();
    });
  },
  Vacuum: vacuum,
  ParseScript(data) {
    return parseScript(data).then((res) => {
      sync.sync();
      return res.data;
    });
  },
  CheckUpdate(id) {
    getScript({ id }).then(checkUpdate)
    .then((updated) => {
      if (updated) sync.sync();
    });
  },
  CheckUpdateAll: checkUpdateAll,
  ParseMeta(code) {
    return parseMeta(code);
  },
  GetRequestId: getRequestId,
  HttpRequest(details, src) {
    httpRequest(details, (res) => {
      browser.tabs.sendMessage(src.tab.id, {
        cmd: 'HttpRequested',
        data: res,
      })
      .catch(noop);
    });
  },
  AbortRequest: abortRequest,
  SetBadge: setBadge,
  SyncAuthorize: sync.authorize,
  SyncRevoke: sync.revoke,
  SyncStart: sync.sync,
  SyncSetConfig: sync.setConfig,
  CacheLoad(data) {
    return cache.get(data) || null;
  },
  CacheHit(data) {
    cache.hit(data.key, data.lifetime);
  },
  Notification: createNotification,
  SetClipboard: setClipboard,
  TabOpen: tabOpen,
  TabClose: tabClose,
  GetAllOptions: getAllOptions,
  GetOptions(data) {
    return data.reduce((res, key) => {
      res[key] = getOption(key);
      return res;
    }, {});
  },
  SetOptions(data) {
    const items = Array.isArray(data) ? data : [data];
    items.forEach((item) => { setOption(item.key, item.value); });
  },
  ConfirmInstall: confirmInstall,
  CheckScript({ name, namespace }) {
    return getScript({ meta: { name, namespace } })
    .then(script => (script && !script.config.removed ? script.meta.version : null));
  },
  CheckPosition() {
    return sortScripts();
  },
  InjectScript(code, src) {
    return browser.tabs.executeScript(src.tab.id, {
      code: `${code};0`,
      runAt: 'document_start',
    });
  },
  TestBlacklist: testBlacklist,
};

function togglePreinject(enable) {
  if (enable) {
    browser.webRequest.onHeadersReceived.addListener(preinject, {
      urls: ['*://*/*'],
      types: ['main_frame', 'sub_frame'],
    });
  } else {
    browser.webRequest.onHeadersReceived.removeListener(preinject);
  }
}

function preinject({ url }) {
  const key = `preinject:${url}`;
  if (!cache.has(key)) {
    // GetInjected message will be sent soon by the content script
    // and it may easily happen while getScriptsByURL is still waiting for browser.storage
    // so we'll let GetInjected await this pending data by storing Promise in the cache
    cache.put(key, getScriptsByURL(url), 250);
  }
}

initialize()
.then(() => {
  browser.runtime.onMessage.addListener((req, src) => {
    const func = commands[req.cmd];
    let res;
    if (func) {
      res = func(req.data, src);
      if (typeof res !== 'undefined') {
        // If res is not instance of native Promise, browser APIs will not wait for it.
        res = Promise.resolve(res)
        .then(data => ({ data }), (error) => {
          if (process.env.DEBUG) console.error(error);
          return { error };
        });
      }
    }
    // undefined will be ignored
    return res || null;
  });
  injectInto = getOption('defaultInjectInto');
  isApplied = getOption('isApplied');
  togglePreinject(isApplied);
  setTimeout(autoUpdate, 2e4);
  sync.initialize();
  resetBlacklist();
  autoCheckRemove();
  global.dispatchEvent(new Event('backgroundInitialized'));
});
