import { isEmpty, sendTabCmd } from '#/common';
import { forEachEntry, forEachKey, objectSet } from '#/common/object';
import { getScript, getValueStoresByIds, dumpValueStores } from './db';
import { commands } from './message';

const openers = {}; // { scriptId: { tabId: { frameId: 1, ... }, ... } }
let cache = {}; // { scriptId: { key: { last: value, tabId: { frameId: value } } } }
let updateScheduled;

Object.assign(commands, {
  /** @return {Promise<Object>} */
  async GetValueStore(id) {
    const stores = await getValueStoresByIds([id]);
    return stores[id] || {};
  },
  /** @param {{ where, store }[]} data
   * @return {Promise<void>} */
  async SetValueStores(data) {
    // Value store will be replaced soon.
    const stores = data.reduce((res, { where, store }) => {
      const id = where.id || getScript(where)?.props.id;
      if (id) res[id] = store;
      return res;
    }, {});
    await Promise.all([
      dumpValueStores(stores),
      broadcastValueStores(groupStoresByFrame(stores)),
    ]);
  },
  /** @return {void} */
  UpdateValue({ id, key, value = null }, src) {
    objectSet(cache, [id, key, 'last'], value);
    objectSet(cache, [id, key, src.tab.id, src.frameId], value);
    updateLater();
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
    objectSet(openers, [id, tabId, frameId], 1);
  });
}

async function updateLater() {
  while (!updateScheduled) {
    updateScheduled = true;
    await 0;
    const currentCache = cache;
    cache = {};
    await doUpdate(currentCache);
    updateScheduled = false;
    if (isEmpty(cache)) break;
  }
}

async function doUpdate(currentCache) {
  const ids = Object.keys(currentCache);
  const valueStores = await getValueStoresByIds(ids);
  ids.forEach((id) => {
    currentCache[id]::forEachEntry(([key, { last }]) => {
      objectSet(valueStores, [id, key], last || undefined);
    });
  });
  await Promise.all([
    dumpValueStores(valueStores),
    broadcastValueStores(groupCacheByFrame(currentCache), { partial: true }),
  ]);
}

async function broadcastValueStores(tabFrameData, { partial } = {}) {
  const tasks = [];
  for (const [tabId, frames] of Object.entries(tabFrameData)) {
    for (const [frameId, frameData] of Object.entries(frames)) {
      if (!isEmpty(frameData)) {
        if (partial) frameData.partial = true;
        tasks.push(sendTabCmd(+tabId, 'UpdatedValues', frameData, { frameId: +frameId }));
        if (tasks.length === 20) await Promise.all(tasks.splice(0)); // throttling
      }
    }
  }
  await Promise.all(tasks);
}

// Returns per tab/frame data with only the changed values
function groupCacheByFrame(cacheData) {
  const toSend = {};
  cacheData::forEachEntry(([id, scriptData]) => {
    const dataEntries = Object.entries(scriptData);
    openers[id]::forEachEntry(([tabId, frames]) => {
      frames::forEachKey((frameId) => {
        dataEntries.forEach(([key, history]) => {
          // Skipping this frame if its last recorded value is identical
          if (history.last !== history[tabId]?.[frameId]) {
            objectSet(toSend, [tabId, frameId, id, key], history.last);
          }
        });
      });
    });
  });
  return toSend;
}

// Returns per tab/frame data
function groupStoresByFrame(stores) {
  const toSend = {};
  stores::forEachEntry(([id, store]) => {
    openers[id]::forEachEntry(([tabId, frames]) => {
      frames::forEachKey(frameId => {
        objectSet(toSend, [tabId, frameId, id], store);
      });
    });
  });
  return toSend;
}
