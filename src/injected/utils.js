import { sendMessage, noop } from 'src/common';

export { sendMessage, noop };

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

export function objEncode(obj) {
  const list = Object.keys(obj).map(name => {
    const value = obj[name];
    const jsonKey = JSON.stringify(name);
    if (typeof value === 'function') return `${jsonKey}:${value.toString()}`;
    return `${jsonKey}:${JSON.stringify(value)}`;
  });
  return `{${list.join(',')}}`;
}

export function getUniqId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
