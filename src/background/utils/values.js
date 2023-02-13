import { isEmpty, sendTabCmd } from '@/common';
import { forEachEntry, objectGet, objectSet } from '@/common/object';
import { getScript } from './db';
import { addOwnCommands, addPublicCommands } from './message';
import storage from './storage';

const nest = (obj, key) => obj[key] || (obj[key] = {}); // eslint-disable-line no-return-assign
/** { scriptId: { tabId: { frameId: {key: raw}, ... }, ... } } */
const openers = {};
let chain = Promise.resolve();
let toSend = {};

addOwnCommands({
  async GetValueStore(id, { tab }) {
    const frames = nest(nest(openers, id), tab.id);
    const values = frames[0] || (frames[0] = await storage.value.getOne(id));
    return values;
  },
  /**
   * @param {Object} data - key can be an id or a uri
   * @return {Promise<void>}
   */
  SetValueStores(data) {
    const toWrite = {};
    data::forEachEntry(([id, store = {}]) => {
      id = getScript({ id: +id, uri: id })?.props.id;
      if (id) {
        toWrite[id] = store;
        toSend[id] = store;
      }
    });
    commit(toWrite);
    return chain;
  },
});

addPublicCommands({
  /**
   * @return {?Promise<void>}
   */
  UpdateValue({ id, key, raw }, { tab, frameId }) {
    const values = objectGet(openers, [id, tab.id, frameId]);
    if (values) { // preventing the weird case of message arriving after the page navigated
      if (raw) values[key] = raw; else delete values[key];
      nest(toSend, id)[key] = raw || null;
      commit({ [id]: values });
      return chain;
    }
  },
});

export function clearValueOpener(tabId, frameId) {
  if (tabId == null) {
    toSend = {};
  }
  openers::forEachEntry(([id, tabs]) => {
    const frames = tabs[tabId];
    if (frames) {
      if (frameId) {
        delete frames[frameId];
        if (isEmpty(frames)) delete tabs[tabId];
      } else {
        delete tabs[tabId];
      }
    }
    if (tabId == null || isEmpty(tabs)) {
      delete openers[id];
    }
  });
}

/**
 * @param {VMInjection.Script[]} injectedScripts
 * @param {number} tabId
 * @param {number} frameId
 */
export function addValueOpener(injectedScripts, tabId, frameId) {
  injectedScripts.forEach(script => {
    const { id, [VALUES]: values } = script;
    if (values) objectSet(openers, [id, tabId, frameId], values);
    else delete openers[id];
  });
}

function commit(data) {
  storage.value.set(data);
  chain = chain.catch(console.warn).then(broadcast);
}

async function broadcast() {
  const tasks = [];
  const toTabs = {};
  toSend::forEachEntry(groupByTab, toTabs);
  toSend = {};
  for (const [tabId, frames] of Object.entries(toTabs)) {
    for (const [frameId, toFrame] of Object.entries(frames)) {
      if (!isEmpty(toFrame)) {
        tasks.push(sendToFrame(+tabId, +frameId, toFrame));
        if (tasks.length === 20) await Promise.all(tasks.splice(0)); // throttling
      }
    }
  }
  await Promise.all(tasks);
}

/** @this {Object} accumulator */
function groupByTab([id, valuesToSend]) {
  const entriesToSend = Object.entries(valuesToSend);
  openers[id]::forEachEntry(([tabId, frames]) => {
    if (tabId < 0) return; // script values editor watches for changes differently
    const toFrames = nest(this, tabId);
    frames::forEachEntry(([frameId, last]) => {
      const toScript = nest(nest(toFrames, frameId), id);
      entriesToSend.forEach(([key, raw]) => {
        if (raw !== last[key]) {
          if (raw) last[key] = raw; else delete last[key];
          toScript[key] = raw;
        }
      });
    });
  });
}

function sendToFrame(tabId, frameId, data) {
  return sendTabCmd(tabId, 'UpdatedValues', data, { frameId }).catch(console.warn);
  // must use catch() to keep Promise.all going
}
