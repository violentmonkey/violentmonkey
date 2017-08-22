export { sendMessage, request } from 'src/common';
export Promise from 'core-js/library/fn/promise';

// cache native properties to avoid being overridden, see violentmonkey/violentmonkey#151
export const { console, CustomEvent } = window;

export function postData(destId, data) {
  // Firefox issue: data must be stringified to avoid cross-origin problem
  const e = new CustomEvent(destId, { detail: JSON.stringify(data) });
  document.dispatchEvent(e);
}

export function inject(code) {
  const script = document.createElement('script');
  const doc = document.body || document.documentElement;
  script.textContent = code;
  doc.appendChild(script);
  try {
    doc.removeChild(script);
  } catch (e) {
    // ignore if body is changed and script is detached
  }
}

// export function encodeObject(obj) {
//   if (Array.isArray(obj)) {
//     return obj.map(encodeObject).join(',');
//   }
//   if (typeof obj === 'function') {
//     let str = obj.toString();
//     const prefix = str.slice(0, str.indexOf('{'));
//     if (prefix.indexOf('=>') < 0 && prefix.indexOf('function ') < 0) {
//       // method definition
//       str = `function ${str}`;
//     }
//     return str;
//   }
//   if (obj && typeof obj === 'object') {
//     const pairs = Object.keys(obj)
//     .map(key => `${JSON.stringify(key)}:${encodeObject(obj[key])}`);
//     return `{${pairs.join(',')}}`;
//   }
//   return JSON.stringify(obj);
// }

export function getUniqId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function bindEvents(srcId, destId, handle) {
  document.addEventListener(srcId, e => {
    const data = JSON.parse(e.detail);
    handle(data);
  }, false);
  return data => { postData(destId, data); };
}

export function attachFunction(id, cb) {
  Object.defineProperty(window, id, {
    value(...args) {
      cb.apply(this, args);
      delete window[id];
    },
    configurable: true,
  });
}
