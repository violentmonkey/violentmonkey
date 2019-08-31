import { initHooks, sendMessage, normalizeKeys } from '.';
import { objectGet, objectSet } from './object';

let options = {};
const hooks = initHooks();
const ready = sendMessage({ cmd: 'GetAllOptions' })
.then((data) => {
  options = data;
  if (data) hooks.fire(data);
});

function getOption(key, def) {
  const keys = normalizeKeys(key);
  return objectGet(options, keys, def);
}

function setOption(key, value) {
  sendMessage({
    cmd: 'SetOptions',
    data: { key, value },
  });
}

function updateOptions(data) {
  Object.keys(data).forEach((key) => {
    objectSet(options, key, data[key]);
  });
  hooks.fire(data);
}

function onReady(cb) {
  ready.then(cb);
}

export default {
  ready: onReady,
  get: getOption,
  set: setOption,
  update: updateOptions,
  hook: hooks.hook,
};
