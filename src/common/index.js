import './polyfills';

export function i18n(name, args) {
  return browser.i18n.getMessage(name, args) || name;
}
export const defaultImage = '/public/images/icon128.png';

export function normalizeKeys(key) {
  let keys = key || [];
  if (!Array.isArray(keys)) keys = keys.toString().split('.');
  return keys;
}

export const object = {
  get(obj, rawKey, def) {
    const keys = normalizeKeys(rawKey);
    let res = obj;
    keys.some((key) => {
      if (res && typeof res === 'object' && (key in res)) {
        res = res[key];
      } else {
        res = def;
        return true;
      }
    });
    return res;
  },
  set(obj, rawKey, val) {
    const keys = normalizeKeys(rawKey);
    if (!keys.length) return val;
    const root = obj || {};
    let sub = root;
    const lastKey = keys.pop();
    keys.forEach((key) => {
      let child = sub[key];
      if (!child) {
        child = {};
        sub[key] = child;
      }
      sub = child;
    });
    if (val == null) {
      delete sub[lastKey];
    } else {
      sub[lastKey] = val;
    }
    return obj;
  },
};

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

export function sendMessage(data) {
  return browser.runtime.sendMessage(data)
  .catch((err) => {
    console.error(err);
  });
}

export function debounce(func, time) {
  let timer;
  function run(thisObj, args) {
    timer = null;
    func.apply(thisObj, args);
  }
  return function debouncedFunction(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, time, this, args);
  };
}

export function noop() {}

export function zfill(input, length) {
  let num = input.toString();
  while (num.length < length) num = `0${num}`;
  return num;
}

export function getUniqId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Get locale attributes such as `@name:zh-CN`
 */
export function getLocaleString(meta, key) {
  const langKey = navigator.languages.map(lang => `${key}:${lang}`).find(item => item in meta);
  return (langKey ? meta[langKey] : meta[key]) || '';
}

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
    if (responseType) xhr.responseType = responseType;
    const headers = Object.assign({}, options.headers);
    let { body } = options;
    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    Object.keys(headers).forEach(key => {
      xhr.setRequestHeader(key, headers[key]);
    });
    xhr.onloadend = () => {
      let data;
      if (responseType === 'blob') {
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
      (xhr.status > 300 ? reject : resolve)({
        url,
        data,
        status: xhr.status,
        // xhr,
      });
    };
    xhr.send(body);
  });
}
