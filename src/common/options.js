import defaults from '@/common/options-defaults';
import { initHooks, sendCmdDirectly } from '.';
import { forEachEntry, objectGet, objectSet } from './object';

let options = {};
const { hook, fire } = initHooks();
const ready = sendCmdDirectly('GetAllOptions', null, { retry: true })
.then((data) => {
  options = data;
  if (data) fire(data);
});

export default {
  ready,
  hook,
  get(key) {
    return objectGet(options, key) ?? objectGet(defaults, key);
  },
  set(key, value) {
    // the updated options object will be propagated from the background script after a pause
    // so meanwhile the local code should be able to see the new value using options.get()
    objectSet(options, key, value);
    return sendCmdDirectly('SetOptions', { [key]: value });
  },
  update(data) {
    // Keys in `data` may be { flattened.like.this: 'foo' }
    const expandedData = {};
    data::forEachEntry(([key, value]) => {
      objectSet(options, key, value);
      objectSet(expandedData, key, value);
    });
    fire(expandedData);
  },
};
