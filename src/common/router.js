import { reactive } from 'vue';
import { loadQuery } from '@/common';
import { showConfirmation } from '@/common/ui';
import { i18n } from './util';

const stack = [];
export const route = reactive(/** @type {VMRoute} */{});
export const lastRoute = () => stack[stack.length - 1] || {};

updateRoute();

function updateRoute(noConfirm) {
  const hash = window.location.hash.slice(1);
  if (noConfirm || !route.confirmChange) {
    const [pathname, search = ''] = hash.split('?');
    /**
     * @typedef {Object} VMRoute
     * @prop {string} hash - entire hash without # e.g. 'path/name?foo=1&bar=2'
     * @prop {string} pathname - 'path/name'
     * @prop {string[]} paths - ['path', 'name']
     * @prop {StringMap} query - {foo: '1', bar: '2'}
     */
    Object.assign(route, {
      hash,
      pathname,
      paths: pathname.split('/'),
      query: loadQuery(search),
    });
  } else if (route.hash !== hash) {
    // restore the pinned route
    setRoute(route.hash, false, true);
    route.confirmChange(hash);
  }
}

// popstate should be the first to ensure hashchange listeners see the correct lastRoute
addEventListener('popstate', () => stack.pop());
addEventListener('hashchange', () => updateRoute(), false);

export function setRoute(hash, replace, noConfirm) {
  let hashString = `${hash}`;
  if (hashString[0] !== '#') hashString = `#${hashString}`;
  if (replace) {
    window.history.replaceState('', null, hashString);
  } else {
    stack.push(Object.assign({}, route));
    window.history.pushState('', null, hashString);
  }
  updateRoute(noConfirm);
}

export function getUnloadSentry(onConfirm, onCancel) {
  async function confirmPopState(hash) {
    if (await showConfirmation(i18n('confirmNotSaved'))) {
      // popstate cannot be prevented so we pin current `route` and display a confirmation
      setRoute(hash, false, true);
      onConfirm?.();
    } else {
      onCancel?.();
    }
  }
  function toggle(state) {
    const onOff = `${state ? 'add' : 'remove'}EventListener`;
    global[onOff]('beforeunload', onUnload);
    route.confirmChange = state && confirmPopState;
  }
  return toggle;
}

function onUnload(e) {
  e.preventDefault();
  // modern browser show their own message text
  e.returnValue = i18n('confirmNotSaved');
}
