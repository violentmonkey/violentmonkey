import { initHooks, sendCmd, normalizeKeys } from '.';
import { forEachEntry, objectGet, objectSet } from './object';

let options = {};
const hooks = initHooks();
const ready = sendCmd('GetAllOptions', null, { retry: true })
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
  sendCmd('SetOptions', { key, value });
}

function updateOptions(data) {
  data::forEachEntry(([key, value]) => {
    objectSet(options, key, value);
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
