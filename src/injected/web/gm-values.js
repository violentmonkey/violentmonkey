import bridge from './bridge';
import store from './store';
import {
  jsonLoad, forEach, slice, objectKeys, objectValues, objectEntries, log,
} from '../utils/helpers';

const { Number } = global;

// Nested objects: scriptId -> keyName -> listenerId -> GMValueChangeListener
export const changeHooks = {};

const dataDecoders = {
  o: jsonLoad,
  // deprecated
  n: Number,
  b: val => val === 'true',
};

bridge.addHandlers({
  UpdatedValues(updates) {
    objectKeys(updates)::forEach((id) => {
      const oldData = store.values[id];
      if (oldData) {
        store.values[id] = updates[id];
        if (id in changeHooks) changedRemotely(id, oldData, updates);
      }
    });
  },
});

export function loadValues(id) {
  return store.values[id];
}

/** @type {function({ id, key, val, raw, oldRaw })} */
export function dumpValue(change = {}) {
  const {
    id, key, raw, oldRaw,
  } = change;
  bridge.post('UpdateValue', {
    id,
    update: { key, value: raw },
  });
  if (raw !== oldRaw) {
    const hooks = changeHooks[id]?.[key];
    if (hooks) {
      change.hooks = hooks;
      notifyChange(change);
    }
  }
}

export function decodeValue(raw) {
  const type = raw[0];
  const handle = dataDecoders[type];
  let val = raw::slice(1);
  try {
    if (handle) val = handle(val);
  } catch (e) {
    if (process.env.DEBUG) log('warn', 'GM_getValue', e);
  }
  return val;
}

// { id, key, val, raw, oldRaw }
function changedRemotely(id, oldData, updates) {
  const data = updates[id];
  id = +id; // the remote id is a string, but all local data structures use a number
  objectEntries(changeHooks[id])::forEach(([key, hooks]) => {
    notifyChange({
      id,
      key,
      hooks,
      oldRaw: oldData[key],
      raw: data[key],
      remote: true,
    });
  });
}

// { hooks, key, val, raw, oldRaw, remote }
function notifyChange(change) {
  const {
    hooks, key, val, raw, oldRaw, remote = false,
  } = change;
  const oldVal = oldRaw && decodeValue(oldRaw);
  const newVal = val == null && raw ? decodeValue(raw) : val;
  objectValues(hooks)::forEach(fn => tryCall(fn, key, oldVal, newVal, remote));
}

function tryCall(fn, ...args) {
  try {
    fn(...args);
  } catch (e) {
    log('error', ['GM_addValueChangeListener', 'callback'], e);
  }
}
