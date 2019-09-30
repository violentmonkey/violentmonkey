function parse(pathInfo) {
  const [pathname, search = ''] = pathInfo.split('?');
  const query = search.split('&').reduce((res, seq) => {
    if (seq) {
      const [key, val] = seq.split('=');
      res[decodeURIComponent(key)] = decodeURIComponent(val);
    }
    return res;
  }, {});
  const paths = pathname.split('/');
  return { pathname, query, paths };
}

const stack = [];
export const route = {};
export const lastRoute = () => stack[stack.length - 1] || {};

updateRoute();

function updateRoute() {
  Object.assign(route, parse(window.location.hash.slice(1)));
}

// popstate should be the first to ensure hashchange listeners see the correct lastRoute
window.addEventListener('popstate', () => stack.pop());
window.addEventListener('hashchange', updateRoute, false);

export function setRoute(hash, replace) {
  let hashString = `${hash}`;
  if (hashString[0] !== '#') hashString = `#${hashString}`;
  if (replace) {
    window.history.replaceState('', null, hashString);
  } else {
    stack.push(Object.assign({}, route));
    window.history.pushState('', null, hashString);
  }
  updateRoute();
}
