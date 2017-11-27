import { CustomEvent, jsonDump, jsonLoad } from './helpers';

export { sendMessage, request, throttle } from 'src/common';

export function postData(destId, data) {
  // Firefox issue: data must be stringified to avoid cross-origin problem
  const e = new CustomEvent(destId, { detail: jsonDump(data) });
  document.dispatchEvent(e);
}

let doInject;
export function inject(code) {
  if (!doInject) {
    const id = getUniqId('VM-');
    const detect = domId => {
      const span = document.createElement('span');
      span.id = domId;
      document.documentElement.appendChild(span);
    };
    injectViaText(`(${detect.toString()})(${jsonDump(id)})`);
    const span = document.querySelector(`#${id}`);
    if (span) {
      span.parentNode.removeChild(span);
      doInject = injectViaText;
    } else {
      // For Firefox in CSP limited pages
      doInject = injectViaBlob;
    }
  }
  doInject(code);
}

function injectViaText(code) {
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

// Firefox does not support script injection by `textCode` in CSP limited pages
// have to inject via blob URL, leading to delayed first injection
function injectViaBlob(code) {
  const script = document.createElement('script');
  const doc = document.body || document.documentElement;
  // https://en.wikipedia.org/wiki/Byte_order_mark
  const blob = new Blob(['\ufeff', code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  script.src = url;
  doc.appendChild(script);
  try {
    doc.removeChild(script);
  } catch (e) {
    // ignore if body is changed and script is detached
  }
  URL.revokeObjectURL(url);
}

export function getUniqId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function bindEvents(srcId, destId, handle) {
  document.addEventListener(srcId, e => {
    const data = jsonLoad(e.detail);
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
