export { sendMessage, request, throttle } from 'src/common';

// cache native properties to avoid being overridden, see violentmonkey/violentmonkey#151
export const { console, CustomEvent, Promise } = window;

export function postData(destId, data) {
  // Firefox issue: data must be stringified to avoid cross-origin problem
  const e = new CustomEvent(destId, { detail: JSON.stringify(data) });
  document.dispatchEvent(e);
}

export function inject(code) {
  const script = document.createElement('script');
  const doc = document.body || document.documentElement;
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  script.src = url;
  doc.appendChild(script);
  try {
    URL.revokeObjectURL(url);
    doc.removeChild(script);
  } catch (e) {
    // ignore if body is changed and script is detached
  }
}

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
