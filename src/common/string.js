import { blob2base64, isDataUri } from './util';

export const nullBool2string = v => v ? '1' : v == null ? '' : '0';

export function leftpad(input, length, pad = '0') {
  let num = input.toString();
  while (num.length < length) num = `${pad}${num}`;
  return num;
}

/**
 * @param {string} browserLang  Language tags from RFC5646 (`[lang]-[script]-[region]-[variant]`, all parts are optional)
 * @param {string} locale  `<lang>`, `<lang>-<region>`
 */
function localeMatch(browserLang, metaLocale) {
  const bParts = browserLang.toLowerCase().split('-');
  const mParts = metaLocale.toLowerCase().split('-');
  let bi = 0;
  let mi = 0;
  while (bi < bParts.length && mi < mParts.length) {
    if (bParts[bi] === mParts[mi]) mi += 1;
    bi += 1;
  }
  return mi === mParts.length;
}

/**
 * Get locale attributes such as `@name:zh-CN`
 */
export function getLocaleString(meta, key, languages = navigator.languages) {
  // zh, zh-cn, zh-tw
  const mls = Object.keys(meta)
    .filter(metaKey => metaKey.startsWith(key + ':'))
    .map(metaKey => metaKey.slice(key.length + 1))
    .sort((a, b) => b.length - a.length);
  let bestLocale;
  for (const lang of languages) {
    bestLocale = mls.find(ml => localeMatch(lang, ml));
    if (bestLocale) break;
  }
  return meta[bestLocale ? `${key}:${bestLocale}` : key] || '';
}

export function getFullUrl(url, base) {
  let obj;
  try {
    obj = new URL(url, base);
  } catch (e) {
    return `data:,${e.message} ${url}`;
  }
  return obj.href;
}

export function encodeFilename(name) {
  // `escape` generated URI has % in it
  return name.replace(/[-\\/:*?"<>|%\s]/g, (m) => {
    let code = m.charCodeAt(0).toString(16);
    if (code.length < 2) code = `0${code}`;
    return `-${code}`;
  });
}

export function decodeFilename(filename) {
  return filename.replace(/-([0-9a-f]{2})/g, (_m, g) => String.fromCharCode(parseInt(g, 16)));
}

export function trueJoin(separator) {
  return this.filter(Boolean).join(separator);
}

/**
 * @param {string} raw - raw value in storage.cache
 * @param {string} [url]
 * @returns {?string}
 */
export function makeDataUri(raw, url) {
  if (isDataUri(url)) return url;
  if (/^(i,|image\/)/.test(raw)) { // workaround for bugs in old VM, see 2e135cf7
    const i = raw.lastIndexOf(',');
    const type = raw.startsWith('image/') ? raw.slice(0, i) : 'image/png';
    return `data:${type};base64,${raw.slice(i + 1)}`;
  }
  return raw;
}

/**
 * @param {VMReq.Response} response
 * @returns {Promise<string>}
 */
export async function makeRaw(response) {
  const type = (response.headers.get('content-type') || '').split(';')[0] || '';
  const body = await blob2base64(response.data);
  return `${type},${body}`;
}

export function loadQuery(string) {
  const res = {};
  if (string) {
    new URLSearchParams(string).forEach((val, key) => {
      res[key] = val;
    });
  }
  return res;
}

export function dumpQuery(dict) {
  return `${new URLSearchParams(dict)}`;
}
