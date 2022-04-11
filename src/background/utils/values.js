import { isEmpty, makePause, sendTabCmd } from '#/common';
import { forEachEntry, forEachKey, objectSet } from '#/common/object';
import { getScript, getValueStoresByIds, dumpValueStores } from './db';
import { commands } from './message';

const openers = {}; // { scriptId: { tabId: { frameId: 1, ... }, ... } }
let cache = {}; // { scriptId: { key: { last: value, tabId: { frameId: value } } } }
let cacheUpd;

Object.assign(commands, {
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
  while (!cacheUpd) {
    await makePause(0);
    cacheUpd = cache;
    cache = {};
    await doUpdate();
    cacheUpd = null;
    if (isEmpty(cache)) break;
  }
}

async function doUpdate() {
  const toSend = {};
  const valueStores = await getValueStoresByIds(Object.keys(cacheUpd));
  cacheUpd::forEachEntry(([id, scriptData]) => {
    scriptData::forEachEntry(([key, history]) => {
      const { last } = history;
      objectSet(valueStores, [id, key], last || undefined);
      openers[id]::forEachEntry(([tabId, frames]) => {
        const tabHistory = history[tabId] || {};
        frames::forEachKey((frameId) => {
          if (tabHistory[frameId] !== last) {
            objectSet(toSend, [tabId, frameId, id, key], last);
          }
        });
      });
    });
  });
  await Promise.all([
    dumpValueStores(valueStores),
    broadcastValueStores(toSend, { partial: true }),
  ]);
}

async function broadcastValueStores(tabFrameData, { partial } = {}) {
  const tasks = [];
  for (const [tabId, frames] of Object.entries(tabFrameData)) {
    for (const [frameId, frameData] of Object.entries(frames)) {
      if (partial) frameData.partial = true;
      tasks.push(sendTabCmd(+tabId, 'UpdatedValues', frameData, { frameId: +frameId }));
      if (tasks.length === 20) await Promise.all(tasks.splice(0)); // throttling
    }
  }
  await Promise.all(tasks);
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
