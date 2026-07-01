import defaults from '@/common/options-defaults';
import { initHooks, sendCmdDirectly } from '.';
import { forEachEntry, objectGet, objectSet } from './object';

let options = {};
const { hook, fire } = initHooks();
const ready = (async () => {
  options = __.MV3 && BGDATA.opts
    || await sendCmdDirectly('GetAllOptions', null, { retry: true });
  if (options) fire(options);
})();

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
