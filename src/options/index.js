import '@/common/browser';
import {
  formatByteLength, getLocaleString, getScriptUpdateUrl, i18n, makePause, sendCmdDirectly, trueJoin,
} from '@/common';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import options from '@/common/options';
import { render } from '@/common/ui';
import '@/common/ui/favicon';
import '@/common/ui/style';
import { kDescription, kName, kStorageSize, performSearch, store } from './utils';
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
 * @param {string} [code]
 */
function initScript(script, sizes, code) {
  const $cache = script.$cache || (script.$cache = {});
  const meta = script.meta || {};
  const { custom } = script;
  const localeName = getLocaleString(meta, kName);
  const desc = [
    meta[kName],
    localeName,
    meta[kDescription],
    getLocaleString(meta, kDescription),
    custom[kName],
    custom[kDescription],
  ]::trueJoin('\n');
  const name = custom[kName] || localeName;
  let total = 0;
  let str = '';
  sizes.forEach((val, i) => {
    total += val;
    if (val) str += `${SIZE_TITLES[i]}: ${formatByteLength(val)}\n`;
  });
  $cache.desc = desc;
  $cache.name = name;
  $cache.lowerName = name.toLocaleLowerCase();
  $cache.tags = custom.tags || '';
  $cache.size = formatByteLength(total, true).replace(' ', '');
  $cache.sizes = str.slice(0, -1).replace(/\x20/g, '\xA0').replace(/[^B]$/gm, '$&B');
  $cache.sizeNum = total;
  $cache[kStorageSize] = sizes[2];
  if (code) $cache.code = code;
  script.$canUpdate = getScriptUpdateUrl(script)
    && (script.config.shouldUpdate ? 1 : -1 /* manual */);
  loadScriptIcon(script, store, true);
}

export function loadData() {
  const id = +store.route.paths[1];
  return requestData(id)
  .catch(id && (() => requestData()));
  /* Catching in order to retry without an id if the id is invalid.
   * Errors will be shown in showUnhandledError. */
}

async function requestData(id) {
  const [data] = await Promise.all([
    sendCmdDirectly('GetData', { id, sizes: true }, { retry: true }),
    options.ready,
  ]);
  const { [SCRIPTS]: allScripts, sizes, ...auxData } = data;
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
    async UpdateScript({ update, where, code } = {}) {
      if (!update) return;
      if (updateThrottle
      || (updateThrottle = store.batch)
      && (updateThrottle = Promise.race([updateThrottle, makePause(500)]))) {
        await updateThrottle;
        updateThrottle = null;
      }
      const i1 = store.scripts.findIndex(item => item.props.id === where.id);
      const i2 = store.removedScripts.findIndex(item => item.props.id === where.id);
      const script = store.scripts[i1] || store.removedScripts[i2]
        || update.meta && store.canRenderScripts && {}; // a new script was just saved or installed
      if (!script) return; // We're in editor that doesn't have data for all scripts
      const [sizes] = await sendCmdDirectly('GetSizes', [where.id]);
      const { search } = store;
      Object.assign(script, update);
      if (script.error && !update.error) script.error = null;
      initScript(script, sizes, code);
      if (search) performSearch([script], search.rules);
      if (update.config?.removed != null) {
        if (update.config.removed) {
          // Note that we don't update store.scripts even if a script is removed,
          // because we want to keep the removed script there to allow the user
          // to undo an accidental removal.
          // We will update store.scripts when the installed list is rerendered.
          store.needRefresh = true;
        } else {
          // Restored from the recycle bin.
          store.removedScripts = store.removedScripts.filter(rs => rs.props.id !== where.id);
        }
      }
      // Update the new list
      const i = script.config.removed ? i2 : i1;
      if (i < 0) {
        script.message = '';
        const list = script.config.removed ? 'removedScripts' : SCRIPTS;
        store[list] = [...store[list], script];
      }
    },
    RemoveScripts(ids) {
      store.removedScripts = store.removedScripts.filter(script => !ids.includes(script.props.id));
    },
  });
}
