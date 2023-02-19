import '@/common/browser';
import {
  formatByteLength, getLocaleString, i18n, makePause, sendCmdDirectly, trueJoin,
} from '@/common';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import options from '@/common/options';
import { render } from '@/common/ui';
import '@/common/ui/favicon';
import '@/common/ui/style';
import { store } from './utils';
import App from './views/app';

// Same order as getSizes and sizesPrefixRe
const SIZE_TITLES = [
  i18n('editNavCode'),
  i18n('editNavSettings'),
  i18n('editNavValues'),
  '@require',
  '@resource',
];
let updateThrottle;

initMain();
render(App);

/**
 * @param {VMScript} script
 * @param {number[]} sizes
 */
function initScript(script, sizes) {
  const meta = script.meta || {};
  const localeName = getLocaleString(meta, 'name');
  const search = [
    meta.name,
    localeName,
    meta.description,
    getLocaleString(meta, 'description'),
    script.custom.name,
    script.custom.description,
  ]::trueJoin('\n');
  const name = script.custom.name || localeName;
  const lowerName = name.toLowerCase();
  let total = 0;
  let str = '';
  sizes.forEach((val, i) => {
    total += val;
    if (val) str += `${SIZE_TITLES[i]}: ${formatByteLength(val)}\n`;
  });
  script.$cache = {
    search,
    name,
    lowerName,
    size: formatByteLength(total, true).replace(' ', ''),
    sizes: str.slice(0, -1).replace(/\x20/g, '\xA0').replace(/[^B]$/gm, '$&B'),
    sizeNum: total,
  };
  loadScriptIcon(script, store, true);
}

export function loadData() {
  const id = +store.route.paths[1];
  return requestData(id ? [id] : null)
  .catch(id && (() => requestData()));
  /* Catching in order to retry without an id if the id is invalid.
   * Errors will be shown in showUnhandledError. */
}

async function requestData(ids) {
  const [data] = await Promise.all([
    sendCmdDirectly('GetData', { ids, sizes: true }, { retry: true }),
    options.ready,
  ]);
  const { scripts: allScripts, sizes, ...auxData } = data;
  Object.assign(store, auxData); // initScripts needs `cache` in store
  const scripts = [];
  const removedScripts = [];
  // modifying scripts without triggering reactivity
  allScripts.forEach((script, i) => {
    initScript(script, sizes[i]);
    (script.config.removed ? removedScripts : scripts).push(script);
  });
  // now we can render
  store.scripts = scripts;
  store.removedScripts = removedScripts;
  store.loading = false;
}

function initMain() {
  store.loading = true;
  loadData();
  Object.assign(handlers, {
    ScriptsUpdated() {
      loadData();
    },
    UpdateSync(data) {
      store.sync = data;
    },
    async UpdateScript({ update, where } = {}) {
      if (!update) return;
      if (updateThrottle
      || (updateThrottle = store.importing)
      && (updateThrottle = Promise.race([updateThrottle, makePause(500)]))) {
        await updateThrottle;
        updateThrottle = null;
      }
      const [sizes] = await sendCmdDirectly('GetSizes', [where.id]);
      const i1 = store.scripts.findIndex(item => item.props.id === where.id);
      const i2 = store.removedScripts.findIndex(item => item.props.id === where.id);
      const script = Object.assign(store.scripts[i1] || store.removedScripts[i2] || {}, update);
      if (script.error && !update.error) script.error = null;
      initScript(script, sizes);
      if (update.config?.removed != null) {
        if (update.config.removed) {
          // Note that we don't update store.scripts even if a script is removed,
          // because we want to keep the removed script there to allow the user
          // to undo an accidental removal.
          // We will update store.scripts when the installed list is rerendered.
          store.needRefresh = true;
        } else {
          // Restored from the recycle bin.
          store.removedScripts = store.removedScripts.filter(script => script.props.id !== where.id);
        }
      }
      // Update the new list
      const i = script.config.removed ? i2 : i1;
      if (i < 0) {
        script.message = '';
        const list = script.config.removed ? 'removedScripts' : 'scripts';
        store[list] = [...store[list], script];
      }
    },
    RemoveScripts(ids) {
      store.removedScripts = store.removedScripts.filter(script => !ids.includes(script.props.id));
    },
  });
}
