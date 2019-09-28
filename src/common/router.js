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

export const route = {};

Object.defineProperties(route, {
  stack: { value: [] },
  last: { get: () => route.stack[route.stack.length - 1] || {} },
});

updateRoute();

function updateRoute() {
  Object.assign(route, parse(window.location.hash.slice(1)));
}

// popstate should be the first to ensure hashchange listeners see the correct route.last
window.addEventListener('popstate', () => route.stack.pop());
window.addEventListener('hashchange', updateRoute, false);

export function setRoute(hash, replace) {
  let hashString = `${hash}`;
  if (hashString[0] !== '#') hashString = `#${hashString}`;
  if (replace) {
    window.history.replaceState('', null, hashString);
  } else {
    route.stack.push(Object.assign({}, route));
    window.history.pushState('', null, hashString);
  }
  updateRoute();
}
