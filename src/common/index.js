export * from './util';

export function i18n(name, args) {
  return browser.i18n.getMessage(name, args) || name;
}
export const defaultImage = '/public/images/icon128.png';

export function normalizeKeys(key) {
  if (key == null) return [];
  if (Array.isArray(key)) return key;
  return `${key}`.split('.').filter(Boolean);
}

export function initHooks() {
  const hooks = [];

  function fire(data) {
    hooks.slice().forEach((cb) => {
      cb(data);
    });
  }

  function hook(callback) {
    hooks.push(callback);
    return () => {
      const i = hooks.indexOf(callback);
      if (i >= 0) hooks.splice(i, 1);
    };
  }

  return { hook, fire };
}

export function sendMessage(payload) {
  const promise = browser.runtime.sendMessage(payload)
  .then((res) => {
    const { data, error } = res || {};
    if (error) return Promise.reject(error);
    return data;
  });
  promise.catch((err) => {
    if (process.env.DEBUG) console.warn(err);
  });
  return promise;
}

export function leftpad(input, length, pad = '0') {
  let num = input.toString();
  while (num.length < length) num = `${pad}${num}`;
  return num;
}

/**
 * Get locale attributes such as `@name:zh-CN`
 */
export function getLocaleString(meta, key) {
  const localeMeta = navigator.languages
  // Use `lang.toLowerCase()` since v2.6.5
  .map(lang => meta[`${key}:${lang}`] || meta[`${key}:${lang.toLowerCase()}`])
  .find(Boolean);
  return localeMeta || meta[key] || '';
}

const binaryTypes = [
  'blob',
  'arraybuffer',
];

/**
 * Make a request.
 * @param {String} url
 * @param {Object} headers
 * @return Promise
 */
export function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const { responseType } = options;
    xhr.open(options.method || 'GET', url, true);
    if (binaryTypes.includes(responseType)) xhr.responseType = responseType;
    const headers = Object.assign({}, options.headers);
    let { body } = options;
    if (body && Object.prototype.toString.call(body) === '[object Object]') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    Object.keys(headers).forEach((key) => {
      xhr.setRequestHeader(key, headers[key]);
    });
    xhr.onload = () => {
      const res = getResponse(xhr, {
        // status for `file:` protocol will always be `0`
        status: xhr.status || 200,
      });
      if (res.status > 300) reject(res);
      else resolve(res);
    };
    xhr.onerror = () => {
      const res = getResponse(xhr, { status: -1 });
      reject(res);
    };
    xhr.onabort = xhr.onerror;
    xhr.ontimeout = xhr.onerror;
    xhr.send(body);
  });
  function getResponse(xhr, extra) {
    const { responseType } = options;
    let data;
    if (binaryTypes.includes(responseType)) {
      data = xhr.response;
    } else {
      data = xhr.responseText;
    }
    if (responseType === 'json') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        // Ignore invalid JSON
      }
    }
    return Object.assign({
      url,
      data,
      xhr,
    }, extra);
  }
}

export function getFullUrl(url, base) {
  const obj = new URL(url, base);
  // Use protocol whitelist to filter URLs
  if (![
    'http:',
    'https:',
    'ftp:',
    'data:',
  ].includes(obj.protocol)) obj.protocol = 'http:';
  return obj.href;
}

export function isRemote(url) {
  return url && !(/^(file:|data:|https?:\/\/localhost[:/]|http:\/\/127\.0\.0\.1[:/])/.test(url));
}

export function cache2blobUrl(raw, { defaultType, type: overrideType } = {}) {
  if (raw) {
    const parts = `${raw}`.split(',');
    const { length } = parts;
    const b64 = parts[length - 1];
    const type = overrideType || parts[length - 2] || defaultType || '';
    // Binary string is not supported by blob constructor,
    // so we have to transform it into array buffer.
    const bin = window.atob(b64);
    const arr = new window.Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type });
    return URL.createObjectURL(blob);
  }
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
