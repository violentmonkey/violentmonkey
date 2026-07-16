import { initHooks } from '.';
import handlers from './handlers';
import { sendCmdDirectly } from './messaging';
import { forEachEntry, objectGet, objectSet } from './object';
import defaults from './options-defaults';

let options = {};
const { hook, fire } = initHooks(() => options);
const ready = (async () => {
  if (__.MV3 && (
    options = BGDATA.opts
  )) {
    await 0; // let the app attach its hooks
  } else {
    options = await sendCmdDirectly('GetAllOptions', null, { retry: true });
  }
  if (options) fire(options);
})();

Object.assign(handlers, {
  UpdateOptions: update,
});

export default {
  ready,
  hook,
  update,
  get(key) {
    return objectGet(options, key) ?? objectGet(defaults, key);
  },
  set(key, value) {
    // the updated options object will be propagated from the background script after a pause
    // so meanwhile the local code should be able to see the new value using options.get()
    objectSet(options, key, value);
    return sendCmdDirectly('SetOptions', { [key]: value });
  },
};

function update(data) {
  // Keys in `data` may be { flattened.like.this: 'foo' }
  const expandedData = {};
  data::forEachEntry(([key, value]) => {
    objectSet(options, key, value);
    objectSet(expandedData, key, value);
  });
  fire(expandedData);
}
