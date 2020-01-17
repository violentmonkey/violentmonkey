import { isEmpty, sendTabCmd } from '#/common';
import {
  forEachEntry, forEachKey, objectPick, objectSet,
} from '#/common/object';
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
  UpdateValue({ id, update: { key, value = null } }, src) {
    // Value will be updated to store later.
    updateLater();
    cache = objectSet(cache, [id, key, 'last'], value);
    objectSet(cache, [id, key, src.tab.id, src.frameId], value);
  },
});

browser.tabs.onRemoved.addListener(resetValueOpener);
browser.tabs.onReplaced.addListener((addedId, removedId) => resetValueOpener(removedId));

export function resetValueOpener(tabId) {
  openers::forEachEntry(([id, openerTabs]) => {
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
      updates::forEachEntry(([key, { last }]) => {
        if (!last) delete valueStore[key];
        else valueStore[key] = last;
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
  updates::forEachEntry(([id, data]) => {
    openers[id]::forEachEntry(([tabId, frames]) => {
      frames.forEach(frameId => {
        objectSet(toSend, [tabId, frameId, id],
          avoidInitiator(data, oldCache[id], tabId, frameId));
      });
    });
  });
  // send the grouped updates
  toSend::forEachEntry(([tabId, frames]) => {
    frames::forEachEntry(([frameId, frameData]) => {
      if (!isEmpty(frameData)) {
        sendTabCmd(+tabId, 'UpdatedValues', frameData, { frameId: +frameId });
      }
    });
  });
}

function avoidInitiator(data, history, tabId, frameId) {
  if (history) {
    let toPick;
    data::forEachKey((key, i, allKeys) => {
      // Not sending `key` to this frame if its last recorded value is identical
      const frameValue = history[key]?.[tabId]?.[frameId];
      if (frameValue !== undefined && frameValue === data[key]) {
        // ...sending the preceding different keys
        if (!toPick) toPick = allKeys.slice(0, i);
      } else {
        // ...sending the subsequent different keys
        if (toPick) toPick.push(key);
      }
    });
    if (toPick) data = objectPick(data, toPick);
  }
  return !isEmpty(data) ? data : undefined; // undef will remove the key in objectSet
}
