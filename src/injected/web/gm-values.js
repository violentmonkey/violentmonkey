import bridge from './bridge';
import store from './store';
import {
  jsonLoad, forEach, slice, objectKeys, log,
} from '../utils/helpers';

const { Number } = global;

const dataDecoders = {
  o: val => jsonLoad(val),
  // deprecated
  n: val => Number(val),
  b: val => val === 'true',
};

bridge.addHandlers({
  UpdatedValues(updates) {
    objectKeys(updates)::forEach((id) => {
      if (id in store.values) {
        store.values[id] = updates[id];
      }
    });
  },
});

export function loadValues(id) {
  return store.values[id];
}

export function dumpValue({ id, key, raw }) {
  bridge.post({
    cmd: 'UpdateValue',
    data: {
      id,
      update: { key, value: raw },
    },
  });
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
