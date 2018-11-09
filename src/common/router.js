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
updateRoute();

function updateRoute() {
  Object.assign(route, parse(window.location.hash.slice(1)));
}

window.addEventListener('hashchange', updateRoute, false);

export function setRoute(hash, replace) {
  let hashString = `${hash}`;
  if (hashString[0] !== '#') hashString = `#${hashString}`;
  if (replace) {
    window.history.replaceState('', null, hashString);
  } else {
    window.history.pushState('', null, hashString);
  }
  updateRoute();
}
