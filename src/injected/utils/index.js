import { CustomEvent, jsonDump, jsonLoad } from './helpers';

export {
  sendMessage, request, throttle, cache2blobUrl,
} from '#/common';

export function postData(destId, data) {
  // Firefox issue: data must be stringified to avoid cross-origin problem
  const e = new CustomEvent(destId, { detail: jsonDump(data) });
  document.dispatchEvent(e);
}

function removeElement(id) {
  const el = document.querySelector(`#${id}`);
  if (el) {
    el.parentNode.removeChild(el);
    return true;
  }
}

export function inject(code) {
  const script = document.createElement('script');
  const id = getUniqId('VM-');
  script.id = id;
  script.textContent = `!${removeElement.toString()}(${JSON.stringify(id)});${code}`;
  document.documentElement.appendChild(script);
  // in case the script is blocked by CSP
  removeElement(id);
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
