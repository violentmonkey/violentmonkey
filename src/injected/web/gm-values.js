import bridge, { addHandlers } from './bridge';
import { storages } from './store';
import { jsonDump } from './util';
import { dumpScriptValue } from '../util';

// Nested objects: scriptId -> keyName -> listenerId -> GMValueChangeListener
export const changeHooks = createNullObj();
const dataDecoders = {
  __proto__: null,
  o: jsonParse,
  n: val => +val,
  b: val => val === 'true',
};
let uploadAsync;
let uploadBuf = createNullObj();
let uploadThrottle;

addHandlers({
  UpdatedValues(updates) {
    objectKeys(updates)::forEach(id => {
      const oldData = storages[id];
      if (oldData) {
        const update = updates[id];
        const keyHooks = changeHooks[id];
        if (keyHooks) changedRemotely(keyHooks, oldData, update);
        else applyPartialUpdate(oldData, update);
      }
    });
  },
});

/**
 * @param {GMContext} context
 * @param {boolean} add
 * @param {string[]|Object} what
 * @return {void|Promise<void>}
 */
export function dumpValue(context, add, what) {
  let res;
  const { id, async } = context;
  const values = storages[id];
  const keyHooks = changeHooks[id];
  for (const key of add ? objectKeys(what) : what) {
    let val, raw, oldRaw, tmp;
    if (add) {
      val = what[key];
      raw = dumpScriptValue(val, jsonDump) || null;
    } else raw = null; // val is `undefined` to match GM_addValueChangeListener docs
    oldRaw = values[key];
    if (add) values[key] = raw;
    else delete values[key];
    if (raw !== oldRaw) {
      (res || (res = uploadBuf[id] || (uploadBuf[id] = createNullObj())))[key] = raw;
      if ((tmp = keyHooks?.[key])) notifyChange(tmp, key, val, raw, oldRaw);
    }
  }
  if (res) {
    res = uploadThrottle || (uploadThrottle = promiseResolve()::then(upload));
    if (async) uploadAsync = true;
  }
  if (async) {
    return res || promiseResolve();
  }
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

function upload() {
  const res = bridge[uploadAsync ? 'send' : 'post']('UpdateValue', uploadBuf);
  uploadBuf = createNullObj();
  uploadThrottle = uploadAsync = false;
  return res;
}
