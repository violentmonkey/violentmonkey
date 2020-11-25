import { showConfirmation } from '#/common/ui';
import { i18n } from './util';

function parse(hash) {
  const [pathname, search = ''] = hash.split('?');
  const query = search.split('&').reduce((res, seq) => {
    if (seq) {
      const [key, val] = seq.split('=');
      res[decodeURIComponent(key)] = decodeURIComponent(val);
    }
    return res;
  }, {});
  const paths = pathname.split('/');
  return {
    hash, pathname, paths, query,
  };
}

const stack = [];
export const route = {};
export const lastRoute = () => stack[stack.length - 1] || {};

updateRoute();

function updateRoute(noConfirm) {
  const hash = window.location.hash.slice(1);
  if (noConfirm || !route.confirmChange) {
    Object.assign(route, parse(hash));
  } else if (route.hash !== hash) {
    // restore the pinned route
    setRoute(route.hash, false, true);
    route.confirmChange(hash);
  }
}

// popstate should be the first to ensure hashchange listeners see the correct lastRoute
window.addEventListener('popstate', () => stack.pop());
window.addEventListener('hashchange', () => updateRoute(), false);

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
    try {
      // popstate cannot be prevented so we pin current `route` and display a confirmation
      await showConfirmation(i18n('confirmNotSaved'));
      setRoute(hash, false, true);
      onConfirm?.();
    } catch {
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
