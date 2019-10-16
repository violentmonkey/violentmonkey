import { initHooks, sendMessage, normalizeKeys } from '.';
import { objectGet, objectSet } from './object';

let options = {};
const hooks = initHooks();
const ready = sendMessage({ cmd: 'GetAllOptions' }, { retry: true })
.then((data) => {
  options = data;
  if (data) hooks.fire(data);
});

function getOption(key, def) {
  const keys = normalizeKeys(key);
  return objectGet(options, keys, def);
}

function setOption(key, value) {
  // the updated options object will be propagated from the background script after a pause
  // so meanwhile the local code should be able to see the new value using options.get()
  objectSet(options, normalizeKeys(key), value);
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

export default {
  ready,
  get: getOption,
  set: setOption,
  update: updateOptions,
  hook: hooks.hook,
};
