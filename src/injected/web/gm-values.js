import bridge from './bridge';
import store from './store';
import {
  jsonLoad, filter, forEach, push, slice,
  objectKeys, objectValues, objectEntries, log, setTimeout,
} from '../utils/helpers';

const { Number } = global;
const perfNow = performance.now.bind(performance);

// Nested objects: scriptId -> keyName -> listenerId -> GMValueChangeListener
export const changeHooks = {};
let localChanges = [];
let cleanupTimer;
// wait until UpdatedValues message arrives (usually it happens in just a few milliseconds)
const CLEANUP_TIMEOUT = 10e3;

const dataDecoders = {
  o: val => jsonLoad(val),
  // deprecated
  n: val => Number(val),
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
  bridge.post({
    cmd: 'UpdateValue',
    data: {
      id,
      update: { key, value: raw },
    },
  });
  if (raw !== oldRaw) changedLocally(change);
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
function changedLocally(change) {
  const keyHooks = changeHooks[change.id];
  const hooks = keyHooks && keyHooks[change.key];
  if (hooks) {
    change.hooks = hooks;
    notifyChange(change);
  }
}

function changedRemotely(id, oldData, updates) {
  const data = updates[id];
  const keyHooks = changeHooks[id];
  // the remote id is a string, but all local data structures use a number
  id = +id;
  /**
   * Since the script instance that produced the change already got its change reports
   * (remote=false), we need to avoid re-reporting with the wrong remote=true parameter,
   * so we coalesce the more detailed local changes to match the remote changes.
   * For a contrived example let's look at this local history:
   *     undefined 'a' - created
   *     'a' 'b'       - changed
   *     'b' undefined - deleted
   * The remote history is debounced so it might look like:
   *     undefined 'a'
   *     'a' undefined
   */
  objectEntries(keyHooks)::forEach(([key, hooks]) => {
    const oldRaw = oldData[key];
    const raw = data[key];
    if (raw === oldRaw) return;
    let found;
    let lookFor = oldRaw;
    localChanges = localChanges::filter((ch) => {
      if (found || ch.id !== id || ch.key !== key) return true;
      if (ch.oldRaw !== lookFor) return;
      lookFor = ch.raw;
      found = lookFor === raw;
    });
    if (!found) {
      notifyChange({
        hooks, id, key, raw, oldRaw, remote: true,
      });
    }
  });
  if (localChanges.length && !cleanupTimer) {
    cleanupTimer = setTimeout(cleanupChanges, CLEANUP_TIMEOUT);
  }
}

// { hooks, key, val, raw, oldRaw, remote }
function notifyChange(change) {
  const {
    hooks, key, val, raw, oldRaw, remote = false,
  } = change;
  const oldVal = oldRaw && decodeValue(oldRaw);
  const newVal = val == null && raw ? decodeValue(raw) : val;
  objectValues(hooks)::forEach(fn => tryCall(fn, key, oldVal, newVal, remote));
  if (!remote) {
    change.expiry = perfNow() + CLEANUP_TIMEOUT;
    localChanges::push(change);
  }
}

function cleanupChanges() {
  const now = perfNow();
  localChanges = localChanges::filter(ch => ch.expiry > now);
  cleanupTimer = localChanges.length
    ? setTimeout(cleanupChanges, CLEANUP_TIMEOUT)
    : 0;
}

function tryCall(fn, ...args) {
  try {
    fn(...args);
  } catch (e) {
    log('error', ['GM_addValueChangeListener', 'callback'], e);
  }
}
