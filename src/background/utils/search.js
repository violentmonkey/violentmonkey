export function loadQuery(string) {
  return string.split('&').reduce((data, piece) => {
    const parts = piece.split('=');
    data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
    return data;
  }, {});
}

export function dumpQuery(dict) {
  return Object.keys(dict)
  .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(dict[key])}`)
  .join('&');
}
