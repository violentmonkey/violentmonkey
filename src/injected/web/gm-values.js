import { forEachEntry, objectValues } from '#/common/object';
import bridge from './bridge';
import store from './store';
import { jsonLoad, forEach, slice, log } from '../utils/helpers';

const { Number } = global;

// Nested objects: scriptId -> keyName -> listenerId -> GMValueChangeListener
export const changeHooks = {};

const dataDecoders = {
  o: jsonLoad,
  n: Number,
  b: val => val === 'true',
};

bridge.addHandlers({
  UpdatedValues(updates) {
    const { partial } = updates;
    updates::forEachEntry(([id, update]) => {
      const oldData = store.values[id];
      if (oldData) {
        const keyHooks = changeHooks[id];
        if (keyHooks) changedRemotely(keyHooks, oldData, update);
        if (partial) applyPartialUpdate(oldData, update);
        else store.values[id] = update;
      }
    });
  },
});

export function loadValues(id) {
  return store.values[id];
}

export function dumpValue(id, key, val, raw, oldRaw) {
  bridge.post('UpdateValue', { id, key, value: raw });
  if (raw !== oldRaw) {
    const hooks = changeHooks[id]?.[key];
    if (hooks) notifyChange(hooks, key, val, raw, oldRaw);
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

function applyPartialUpdate(data, update) {
  update::forEachEntry(([key, val]) => {
    if (val) data[key] = val;
    else delete data[key];
  });
}

function changedRemotely(keyHooks, data, update) {
  update::forEachEntry(([key, raw]) => {
    const hooks = keyHooks[key];
    if (hooks) {
      if (!raw) raw = undefined; // partial `update` currently uses null for deleted values
      const oldRaw = data[key];
      if (oldRaw !== raw) {
        data[key] = raw; // will be deleted later in applyPartialUpdate if empty
        notifyChange(hooks, key, undefined, raw, oldRaw, true);
      }
    }
  });
}

function notifyChange(hooks, key, val, raw, oldRaw, remote = false) {
  // converting `null` from messaging to `undefined` to match the documentation and TM
  const oldVal = (oldRaw || undefined) && decodeValue(oldRaw);
  const newVal = val === undefined && raw ? decodeValue(raw) : val;
  objectValues(hooks)::forEach(fn => tryCall(fn, key, oldVal, newVal, remote));
}

function tryCall(fn, ...args) {
  try {
    fn(...args);
  } catch (e) {
    log('error', ['GM_addValueChangeListener', 'callback'], e);
  }
}
