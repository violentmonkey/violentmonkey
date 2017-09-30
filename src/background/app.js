import 'src/common/browser';
import { i18n, defaultImage } from 'src/common';
import { objectGet } from 'src/common/object';
import * as sync from './sync';
import {
  cache,
  getRequestId, httpRequest, abortRequest, confirmInstall,
  newScript, parseMeta,
  setClipboard, checkUpdate,
  getOption, setOption, hookOptions, getAllOptions,
  initialize, broadcast,
} from './utils';
import {
  getScripts, removeScript, getData, checkRemove, getScriptsByURL,
  updateScriptInfo, getExportData, getScriptCode,
  getScriptByIds, moveScript, vacuum, parseScript, getScript,
  normalizePosition,
} from './utils/db';
import { resetBlacklist } from './utils/tester';
import { setValueStore, updateValueStore } from './utils/values';

const VM_VER = browser.runtime.getManifest().version;

hookOptions(changes => {
  if ('isApplied' in changes) setIcon(changes.isApplied);
  browser.runtime.sendMessage({
    cmd: 'UpdateOptions',
    data: changes,
  });
});

function checkUpdateAll() {
  setOption('lastUpdate', Date.now());
  getScripts()
  .then(scripts => {
    const toUpdate = scripts.filter(item => objectGet(item, 'config.shouldUpdate'));
    return Promise.all(toUpdate.map(checkUpdate));
  })
  .then(updatedList => {
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

const commands = {
  NewScript() {
    return newScript();
  },
  RemoveScript(id) {
    return removeScript(id)
    .then(() => { sync.sync(); });
  },
  GetData() {
    return checkRemove()
    .then(changed => {
      if (changed) sync.sync();
      return getData();
    })
    .then(data => {
      data.sync = sync.getStates();
      data.version = VM_VER;
      return data;
    });
  },
  GetInjected(url, src) {
    const data = {
      isApplied: getOption('isApplied'),
      version: VM_VER,
    };
    setTimeout(() => {
      // delayed to wait for the tab URL updated
      if (src.tab && url === src.tab.url) {
        browser.tabs.sendMessage(src.tab.id, { cmd: 'GetBadge' });
      }
    });
    return data.isApplied ? (
      getScriptsByURL(url).then(res => Object.assign(data, res))
    ) : data;
  },
  UpdateScriptInfo({ id, config }) {
    return updateScriptInfo(id, {
      config,
      custom: {
        modified: Date.now(),
      },
    })
    .then(([script]) => {
      sync.sync();
      browser.runtime.sendMessage({
        cmd: 'UpdateScript',
        data: {
          where: { id: script.props.id },
          update: script,
        },
      });
    });
  },
  SetValueStore({ where, valueStore }) {
    // Value store will be replaced soon.
    return setValueStore(where, valueStore);
  },
  UpdateValue({ id, update }) {
    // Value will be updated to store later.
    return updateValueStore(id, update);
  },
  ExportZip({ ids, values }) {
    return getExportData(ids, values);
  },
  GetScriptCode(id) {
    return getScriptCode(id);
  },
  GetMetas(ids) {
    return getScriptByIds(ids);
  },
  Move({ id, offset }) {
    return moveScript(id, offset)
    .then(() => { sync.sync(); });
  },
  Vacuum: vacuum,
  ParseScript(data) {
    return parseScript(data).then(res => {
      browser.runtime.sendMessage(res);
      sync.sync();
      return res.data;
    });
  },
  CheckUpdate(id) {
    getScript({ id }).then(checkUpdate)
    .then(updated => {
      if (updated) sync.sync();
    });
  },
  CheckUpdateAll: checkUpdateAll,
  ParseMeta(code) {
    return parseMeta(code);
  },
  AutoUpdate: autoUpdate,
  GetRequestId: getRequestId,
  HttpRequest(details, src) {
    httpRequest(details, res => {
      browser.tabs.sendMessage(src.tab.id, {
        cmd: 'HttpRequested',
        data: res,
      });
    });
  },
  AbortRequest: abortRequest,
  SetBadge: setBadge,
  SyncAuthorize: sync.authorize,
  SyncRevoke: sync.revoke,
  SyncStart: sync.sync,
  CacheLoad(data) {
    return cache.get(data) || null;
  },
  CacheHit(data) {
    cache.hit(data.key, data.lifetime);
  },
  Notification(data) {
    return browser.notifications.create({
      type: 'basic',
      title: data.title || i18n('extName'),
      message: data.text,
      iconUrl: data.image || defaultImage,
    });
  },
  SetClipboard: setClipboard,
  TabOpen(data, src) {
    const srcTab = src.tab || {};
    return browser.tabs.create({
      url: data.url,
      active: data.active,
      windowId: srcTab.windowId,
      index: srcTab.index + 1,
    })
    .then(tab => ({ id: tab.id }));
  },
  TabClose(data, src) {
    const tabId = (data && data.id) || (src.tab && src.tab.id);
    if (tabId) browser.tabs.remove(tabId);
  },
  GetAllOptions: getAllOptions,
  GetOptions(data) {
    return data.reduce((res, key) => {
      res[key] = getOption(key);
      return res;
    }, {});
  },
  SetOptions(data) {
    const items = Array.isArray(data) ? data : [data];
    items.forEach(item => { setOption(item.key, item.value); });
  },
  ConfirmInstall: confirmInstall,
  CheckScript({ name, namespace }) {
    return getScript({ meta: { name, namespace } })
    .then(script => (script ? script.meta.version : null));
  },
  CheckPosition() {
    return normalizePosition();
  },
};

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
        .then(data => ({ data }), error => {
          if (process.env.DEBUG) console.error(error);
          return { error };
        });
      }
    }
    return res;
  });
  setTimeout(autoUpdate, 2e4);
  sync.initialize();
  resetBlacklist();
  checkRemove();
});

// Common functions

const badges = {};
function setBadge(num, src) {
  let data = badges[src.id];
  if (!data) {
    data = { num: 0 };
    badges[src.id] = data;
  }
  data.num += num;
  browser.browserAction.setBadgeBackgroundColor({
    color: '#808',
    tabId: src.tab.id,
  });
  const text = ((getOption('showBadge') && data.num) || '').toString();
  browser.browserAction.setBadgeText({
    text,
    tabId: src.tab.id,
  });
  if (data.timer) clearTimeout(data.timer);
  data.timer = setTimeout(() => { delete badges[src.id]; }, 300);
}

function setIcon(isApplied) {
  browser.browserAction.setIcon({
    path: {
      19: `/public/images/icon19${isApplied ? '' : 'w'}.png`,
      38: `/public/images/icon38${isApplied ? '' : 'w'}.png`,
    },
  });
}
setIcon(getOption('isApplied'));

browser.notifications.onClicked.addListener(id => {
  broadcast({
    cmd: 'NotificationClick',
    data: id,
  });
});

browser.notifications.onClosed.addListener(id => {
  broadcast({
    cmd: 'NotificationClose',
    data: id,
  });
});

browser.tabs.onRemoved.addListener(id => {
  broadcast({
    cmd: 'TabClosed',
    data: id,
  });
});
