import { sendTabCmd } from '#/common';
import { getValueStoresByIds, dumpValueStores, dumpValueStore } from './db';
import { commands } from './message';

const openers = {}; // scriptId: { openerId: 1, ... }
const tabScripts = {}; // openerId: { scriptId: 1, ... }
let cache;
let timer;

Object.assign(commands, {
  /** @return {Promise<Object>} */
  async GetValueStore(id) {
    const stores = await getValueStoresByIds([id]);
    return stores[id] || {};
  },
  /** @return {Promise<void>} */
  async SetValueStore({ where, valueStore }) {
    // Value store will be replaced soon.
    const store = await dumpValueStore(where, valueStore);
    broadcastUpdates(store);
  },
  /** @return {Promise<void>} */
  UpdateValue({ id, update }) {
    // Value will be updated to store later.
    updateLater();
    const { key, value } = update;
    if (!cache) cache = {};
    let updates = cache[id];
    if (!updates) {
      updates = {};
      cache[id] = updates;
    }
    updates[key] = value || null;
  },
});

browser.tabs.onRemoved.addListener(resetValueOpener);

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

async function doUpdate() {
  const currentCache = cache;
  cache = null;
  const ids = Object.keys(currentCache);
  try {
    const valueStores = await getValueStoresByIds(ids);
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
    await broadcastUpdates(await dumpValueStores(valueStores));
  } catch (err) {
    console.error('Values error:', err);
  }
  timer = null;
  if (cache) updateLater();
}

function broadcastUpdates(updates) {
  if (updates) {
    const updatedOpeners = Object.keys(updates)
    .reduce((map, scriptId) => Object.assign(map, openers[scriptId]), {});
    Object.keys(updatedOpeners)
    .forEach(openerId => sendTabCmd(+openerId, 'UpdatedValues', updates));
  }
}
