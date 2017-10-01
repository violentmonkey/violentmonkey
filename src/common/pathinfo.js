function parseLocation(pathInfo) {
  const [path, qs] = pathInfo.split('?');
  const query = (qs || '').split('&').reduce((res, seq) => {
    if (seq) {
      const [key, val] = seq.split('=');
      res[decodeURIComponent(key)] = decodeURIComponent(val);
    }
    return res;
  }, {});
  return { path, query };
}

export default function getPathInfo() {
  return parseLocation(window.location.hash.slice(1));
}
