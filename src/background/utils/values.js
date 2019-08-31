import { noop } from '#/common';
import { getValueStoresByIds, dumpValueStores, dumpValueStore } from './db';

const openers = {}; // scriptId: { openerId: 1, ... }
const tabScripts = {}; // openerId: { scriptId: 1, ... }
let cache;
let timer;

browser.tabs.onRemoved.addListener((id) => {
  resetValueOpener(id);
});

export function updateValueStore(id, update) {
  updateLater();
  const { key, value } = update;
  if (!cache) cache = {};
  let updates = cache[id];
  if (!updates) {
    updates = {};
    cache[id] = updates;
  }
  updates[key] = value || null;
}

export function setValueStore(where, value) {
  return dumpValueStore(where, value)
  .then(broadcastUpdates);
}

export function resetValueOpener(openerId) {
  const scriptMap = tabScripts[openerId];
  if (scriptMap) {
    Object.keys(scriptMap).forEach((scriptId) => {
      const map = openers[scriptId];
      if (map) delete map[openerId];
    });
    delete tabScripts[openerId];
  }
}

export function addValueOpener(openerId, scriptIds) {
  let scriptMap = tabScripts[openerId];
  if (!scriptMap) {
    scriptMap = {};
    tabScripts[openerId] = scriptMap;
  }
  scriptIds.forEach((scriptId) => {
    scriptMap[scriptId] = 1;
    let openerMap = openers[scriptId];
    if (!openerMap) {
      openerMap = {};
      openers[scriptId] = openerMap;
    }
    openerMap[openerId] = 1;
  });
}

function updateLater() {
  if (!timer) {
    timer = Promise.resolve().then(doUpdate);
    // timer = setTimeout(doUpdate);
  }
}

function doUpdate() {
  const currentCache = cache;
  cache = null;
  const ids = Object.keys(currentCache);
  getValueStoresByIds(ids)
  .then((valueStores) => {
    ids.forEach((id) => {
      const valueStore = valueStores[id] || {};
      valueStores[id] = valueStore;
      const updates = currentCache[id] || {};
      Object.keys(updates).forEach((key) => {
        const value = updates[key];
        if (!value) delete valueStore[key];
        else valueStore[key] = value;
      });
    });
    return dumpValueStores(valueStores);
  })
  .then(broadcastUpdates)
  .catch((err) => {
    console.error('Values error:', err);
  })
  .then(() => {
    timer = null;
    if (cache) updateLater();
  });
}

function broadcastUpdates(updates) {
  if (updates) {
    const updatedOpeners = Object.keys(updates)
    .reduce((map, scriptId) => Object.assign(map, openers[scriptId]), {});
    Object.keys(updatedOpeners).forEach((openerId) => {
      browser.tabs.sendMessage(+openerId, {
        cmd: 'UpdatedValues',
        data: updates,
      })
      .catch(noop);
    });
  }
}
