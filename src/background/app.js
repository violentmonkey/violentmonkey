import 'src/common/browser';
import { i18n, defaultImage } from 'src/common';
import * as sync from './sync';
import {
  cache, vmdb,
  getRequestId, httpRequest, abortRequest, confirmInstall,
  newScript, parseMeta,
  setClipboard, checkUpdate,
  getOption, setOption, hookOptions, getAllOptions,
} from './utils';

const VM_VER = browser.runtime.getManifest().version;

hookOptions(changes => {
  if ('isApplied' in changes) setIcon(changes.isApplied);
  browser.runtime.sendMessage({
    cmd: 'UpdateOptions',
    data: changes,
  });
});

function broadcast(data) {
  browser.tabs.query({})
  .then(tabs => {
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, data);
    });
  });
}

function checkUpdateAll() {
  setOption('lastUpdate', Date.now());
  vmdb.getScriptsByIndex('update', 1)
  .then(scripts => Promise.all(scripts.map(checkUpdate)))
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
    return vmdb.removeScript(id)
    .then(() => { sync.sync(); });
  },
  GetData() {
    return vmdb.getData().then(data => {
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
    return data.isApplied
    ? vmdb.getScriptsByURL(url).then(res => Object.assign(data, res))
    : data;
  },
  UpdateScriptInfo(data) {
    return vmdb.updateScriptInfo(data.id, data, {
      modified: Date.now(),
    })
    .then(script => {
      sync.sync();
      browser.runtime.sendMessage({
        cmd: 'UpdateScript',
        data: script,
      });
    });
  },
  SetValue(data) {
    return vmdb.setValue(data.uri, data.values)
    .then(() => {
      broadcast({
        cmd: 'UpdateValues',
        data: {
          uri: data.uri,
          values: data.values,
        },
      });
    });
  },
  ExportZip(data) {
    return vmdb.getExportData(data.ids, data.values);
  },
  GetScript(id) {
    return vmdb.getScriptData(id);
  },
  GetMetas(ids) {
    return vmdb.getScriptInfos(ids);
  },
  Move(data) {
    return vmdb.moveScript(data.id, data.offset)
    .then(() => { sync.sync(); });
  },
  Vacuum: vmdb.vacuum,
  ParseScript(data) {
    return vmdb.parseScript(data).then(res => {
      browser.runtime.sendMessage(res);
      sync.sync();
      return res.data;
    });
  },
  CheckUpdate(id) {
    vmdb.getScript(id).then(checkUpdate)
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
  TabOpen(data) {
    return browser.tabs.create({
      url: data.url,
      active: data.active,
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
  CheckPosition: vmdb.checkPosition,
  ConfirmInstall: confirmInstall,
  CheckScript({ name, namespace }) {
    return vmdb.queryScript(null, { name, namespace })
    .then(script => (script ? script.meta.version : null));
  },
};

vmdb.initialized.then(() => {
  browser.runtime.onMessage.addListener((req, src) => {
    const func = commands[req.cmd];
    let res;
    if (func) {
      res = func(req.data, src);
      if (typeof res !== 'undefined') {
        // If res is not instance of native Promise, browser APIs will not wait for it.
        res = Promise.resolve(res)
        .then(data => ({ data }), error => ({ error }));
      }
    }
    return res;
  });
  setTimeout(autoUpdate, 2e4);
  sync.initialize();

  // XXX fix position regression in v2.6.3
  vmdb.checkPosition();
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
  if (id === 'VM-NoGrantWarning') {
    browser.tabs.create({
      url: 'http://wiki.greasespot.net/@grant',
    });
  } else {
    broadcast({
      cmd: 'NotificationClick',
      data: id,
    });
  }
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
