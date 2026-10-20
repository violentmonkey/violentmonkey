import { buffer2string, string2uint8array } from '@/common/util';

const SOURCE_KEY_RE = /^(?:code:|req:)/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function decodeSource(key, value) {
  if (!SOURCE_KEY_RE.test(key) || value?.vmSource !== 1) return value;
  let source;
  try {
    source = JSON.parse(decoder.decode(string2uint8array(null, value.data)));
  } catch {
    source = null;
  }
  if (typeof source === 'string') return source;
  throw new Error('Invalid stored userscript source: ' + key);
}

function encodeSource(key, value) {
  return SOURCE_KEY_RE.test(key) && typeof value === 'string'
    ? {
      vmSource: 1,
      data: btoa(buffer2string(encoder.encode(JSON.stringify(value)))),
    }
    : value;
}

export default function protectSourceStorage(api) {
  let ready;
  const initialize = () => ready ||= Promise.resolve().then(async () => {
    // Independent MV3 workers could otherwise overwrite a newer save with their migration snapshot.
    if (__.MV3) return;
    const data = await api.get();
    const updates = {};
    for (const [key, value] of Object.entries(data)) {
      if (SOURCE_KEY_RE.test(key) && typeof value === 'string') {
        updates[key] = encodeSource(key, value);
      }
    }
    if (Object.keys(updates).length) await api.set(updates);
  });
  const get = async (...args) => {
    await initialize();
    const data = await api.get(...args);
    for (const key of Object.keys(data)) data[key] = decodeSource(key, data[key]);
    return data;
  };
  const set = async data => {
    await initialize();
    return api.set(Object.fromEntries(Object.entries(data)
      .map(([key, value]) => [key, encodeSource(key, value)])));
  };
  return new Proxy(api, {
    get(target, key) {
      if (key === 'get') return get;
      if (key === 'set') return set;
      const value = Reflect.get(target, key, target);
      if (typeof value === 'function' && (key === 'remove' || key === 'clear')) {
        return (...args) => initialize().then(() => value.apply(target, args));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
