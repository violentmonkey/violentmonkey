import { initHooks, sendMessage, object, normalizeKeys } from '.';

let options = {};
const hooks = initHooks();
const ready = sendMessage({ cmd: 'GetAllOptions' })
.then(data => {
  options = data;
  if (data) hooks.fire(data);
});

function getOption(key, def) {
  const keys = normalizeKeys(key);
  return object.get(options, keys, def);
}

function setOption(key, value) {
  sendMessage({
    cmd: 'SetOptions',
    data: { key, value },
  });
}

function updateOptions(data) {
  Object.keys(data).forEach((key) => {
    object.set(options, key, data[key]);
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
