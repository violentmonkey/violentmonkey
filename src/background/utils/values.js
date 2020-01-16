import { isEmpty, sendTabCmd } from '#/common';
import { objectSet } from '#/common/object';
import { getValueStoresByIds, dumpValueStores, dumpValueStore } from './db';
import { commands } from './message';

const openers = {}; // { scriptId: { tabId: [frameId, ... ], ... } }
let cache; // { scriptId: { key: [{ value, src }, ... ], ... } }
let updateScheduled;

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
    if (store) broadcastUpdates(store);
  },
  /** @return {Promise<void>} */
  UpdateValue({ id, update: { key, value } }, src) {
    // Value will be updated to store later.
    updateLater();
    cache = objectSet(cache, [id, [key]], {
      value: value || null,
      src: `${src.tab.id}:${src.frameId}`,
    });
  },
});

browser.tabs.onRemoved.addListener(resetValueOpener);
browser.tabs.onReplaced.addListener((addedId, removedId) => resetValueOpener(removedId));

export function resetValueOpener(tabId) {
  Object.entries(openers).forEach(([id, openerTabs]) => {
    if (tabId in openerTabs) {
      delete openerTabs[tabId];
      if (isEmpty(openerTabs)) delete openers[id];
    }
  });
}

export function addValueOpener(tabId, frameId, scriptIds) {
  scriptIds.forEach((id) => {
    objectSet(openers, [id, [tabId]], frameId);
  });
}

async function updateLater() {
  if (!updateScheduled) {
    updateScheduled = true;
    await 0;
    doUpdate();
    updateScheduled = false;
    if (cache) updateLater();
  }
}

async function doUpdate() {
  const ids = Object.keys(cache);
  const currentCache = cache;
  cache = null;
  try {
    const valueStores = await getValueStoresByIds(ids);
    ids.forEach((id) => {
      const valueStore = valueStores[id] || (valueStores[id] = {});
      const updates = currentCache[id] || {};
      Object.keys(updates).forEach((key) => {
        const history = updates[key];
        if (!history) delete valueStore[key];
        else valueStore[key] = history[history.length - 1].value;
      });
    });
    await dumpValueStores(valueStores);
    await broadcastUpdates(valueStores, currentCache);
  } catch (err) {
    console.error('Values error:', err);
  }
}

function broadcastUpdates(updates, oldCache = {}) {
  // group updates by frame
  const toSend = {};
  Object.entries(updates).forEach(([id, data]) => {
    Object.entries(openers[id]).forEach(([tabId, frames]) => {
      frames.forEach(frameId => {
        objectSet(toSend, [tabId, frameId, id],
          avoidInitiator(data, oldCache[id], tabId, frameId));
      });
    });
  });
  // send the grouped updates
  Object.entries(toSend).forEach(([tabId, frames]) => {
    Object.entries(frames).forEach(([frameId, frameData]) => {
      if (!isEmpty(frameData)) {
        sendTabCmd(+tabId, 'UpdatedValues', frameData, { frameId: +frameId });
      }
    });
  });
}

function avoidInitiator(data, history, tabId, frameId) {
  let clone;
  if (history) {
    const src = `${tabId}:${frameId}`;
    Object.entries(data).forEach(([key, value]) => {
      if (history[key]?.some(h => h.value === value && h.src === src)) {
        if (!clone) clone = { ...data };
        delete clone[key];
      }
    });
    if (clone) data = clone;
  }
  return !isEmpty(data) ? data : undefined; // undef will remove the key in objectSet
}
