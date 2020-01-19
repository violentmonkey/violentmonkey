export function loadQuery(string) {
  return string.split('&').reduce((data, piece) => {
    const [key, val] = piece.split('=').map(decodeURIComponent);
    data[key] = val;
    return data;
  }, {});
}

export function dumpQuery(dict) {
  return Object.entries(dict)
  .map(keyVal => keyVal.map(encodeURIComponent).join('='))
  .join('&');
}
