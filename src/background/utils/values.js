import { isEmpty, makePause, sendTabCmd } from '@/common';
import { forEachEntry, forEachValue, nest, objectGet, objectSet } from '@/common/object';
import { getScript } from './db';
import { addOwnCommands, addPublicCommands } from './init';
import storage, { S_VALUE, S_VALUE_PRE } from './storage';
import { cachedStorageApi } from './storage-cache';
import { getFrameDocIdAsObj, getFrameDocIdFromSrc } from './tabs';

/** { scriptId: { tabId: { frameId: {key: raw}, ... }, ... } } */
const openers = {};
let chain;
let toSend = {};

addOwnCommands({
  async GetValueStore(id, { tab }) {
    const frames = nest(nest(openers, id), tab.id);
    const values = frames[0] || (frames[0] = await storage[S_VALUE].getOne(id));
    return values;
  },
  /**
   * @param {Object} data - key can be an id or a uri
   */
  SetValueStores(data) {
    const toWrite = {};
    data::forEachEntry(([id, store = {}]) => {
      id = getScript({ id: +id, uri: id })?.props.id;
      if (id) {
        toWrite[S_VALUE_PRE + id] = store;
        toSend[id] = store;
      }
    });
    commit(toWrite, cachedStorageApi);
  },
});

addPublicCommands({
  UpdateValue(what, src) {
    const res = {};
    for (const id in what) {
      const values = objectGet(openers, [id, src.tab.id, getFrameDocIdFromSrc(src)]);
      // preventing the weird case of message arriving after the page navigated
      if (!values) return;
      const hub = nest(toSend, id);
      const data = what[id];
      for (const key in data) {
        const raw = data[key];
        if (raw) values[key] = raw; else delete values[key];
        hub[key] = raw || null;
      }
      res[id] = values;
    }
    commit(res);
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
 * @param {VMInjection.Script[] | number[]} injectedScripts
 * @param {number} tabId
 * @param {number|string} frameId
 */
export async function addValueOpener(injectedScripts, tabId, frameId) {
  const valuesById = +injectedScripts[0] // restoring storage for page from bfcache
    && await storage[S_VALUE].getMulti(injectedScripts);
  for (const script of injectedScripts) {
    const id = valuesById ? script : script.id;
    const values = valuesById ? valuesById[id] || null : script[VALUES];
    if (values) objectSet(openers, [id, tabId, frameId], Object.assign({}, values));
    else delete openers[id];
  }
}

/** Moves values of a pre-rendered page identified by documentId to frameId:0 */
export function reifyValueOpener(ids, documentId) {
  for (const id of ids) {
    openers[id]::forEachValue(frames => {
      if (documentId in frames) {
        frames[0] = frames[documentId];
        delete frames[documentId];
      }
    });
  }
}

function commit(data, api) {
  (api || storage[S_VALUE]).set(data, !!api);
  chain = chain?.catch(console.warn).then(broadcast)
    || broadcast();
}

async function broadcast() {
  const toTabs = {};
  let num = 0;
  toSend::forEachEntry(groupByTab, toTabs);
  toSend = {};
  for (const [tabId, frames] of Object.entries(toTabs)) {
    for (const [frameId, toFrame] of Object.entries(frames)) {
      if (!isEmpty(toFrame)) {
        // Not awaiting because the tab may be busy/sleeping
        sendTabCmd(+tabId, 'UpdatedValues', toFrame, getFrameDocIdAsObj(frameId));
        if (!(++num % 20)) await makePause(); // throttling
      }
    }
  }
  chain = null;
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
