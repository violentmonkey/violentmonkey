export function tryBrowserListener(event, method, ...args) {
  try {
    if (typeof event?.[method] !== 'function') return false;
    event[method](...args);
    return true;
  } catch {
    return false;
  }
}
