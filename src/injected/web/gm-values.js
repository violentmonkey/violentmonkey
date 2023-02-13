import bridge, { addHandlers } from './bridge';
import store from './store';

// Nested objects: scriptId -> keyName -> listenerId -> GMValueChangeListener
export const changeHooks = createNullObj();

const dataDecoders = {
  __proto__: null,
  o: jsonParse,
  n: val => +val,
  b: val => val === 'true',
};

addHandlers({
  UpdatedValues(updates) {
    objectKeys(updates)::forEach(id => {
      const oldData = store[VALUES][id];
      if (oldData) {
        const update = updates[id];
        const keyHooks = changeHooks[id];
        if (keyHooks) changedRemotely(keyHooks, oldData, update);
        else applyPartialUpdate(oldData, update);
      }
    });
  },
});

export function loadValues(id) {
  return store[VALUES][id];
}

/**
 * @param {number} id
 * @param {string} key
 * @param {?} val
 * @param {?string} raw
 * @param {?string} oldRaw
 * @param {GMContext} context
 * @return {void|Promise<void>}
 */
export function dumpValue(id, key, val, raw, oldRaw, context) {
  let res;
  if (raw !== oldRaw) {
    res = bridge[context.async ? 'send' : 'post']('UpdateValue', { id, key, raw });
    const hooks = changeHooks[id]?.[key];
    if (hooks) notifyChange(hooks, key, val, raw, oldRaw);
  } else if (context.async) {
    res = promiseResolve();
  }
  return res;
}

export function decodeValue(raw) {
  const type = raw[0];
  const handle = dataDecoders[type];
  let val = raw::slice(1);
  try {
    if (handle) val = handle(val);
  } catch (e) {
    if (process.env.DEBUG) log('warn', ['GM_getValue'], e);
  }
  return val;
}

function applyPartialUpdate(data, update) {
  objectKeys(update)::forEach(key => {
    const val = update[key];
    if (val) data[key] = val;
    else delete data[key];
  });
}

function changedRemotely(keyHooks, data, update) {
  objectKeys(update)::forEach(key => {
    const raw = update[key] || undefined; // partial `update` currently uses null for deleted values
    const oldRaw = data[key];
    if (oldRaw !== raw) {
      if (raw) data[key] = raw; else delete data[key];
      const hooks = keyHooks[key];
      if (hooks) notifyChange(hooks, key, undefined, raw, oldRaw, true);
    }
  });
}

function notifyChange(hooks, key, val, raw, oldRaw, remote = false) {
  // converting `null` from messaging to `undefined` to match the documentation and TM
  const oldVal = (oldRaw || undefined) && decodeValue(oldRaw);
  const newVal = val === undefined && raw ? decodeValue(raw) : val;
  objectValues(hooks)::forEach(fn => {
    try {
      fn(key, oldVal, newVal, remote);
    } catch (e) {
      log('error', ['GM_addValueChangeListener', 'callback'], e);
    }
  });
}
