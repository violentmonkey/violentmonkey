import initCache from '#/common/cache';
import { commands } from './message';

const cache = initCache({
  /* Keeping the data for one hour since chrome.storage.local is insanely slow in Chrome,
     it can takes seconds to read it when injecting tabs with a big script/value, which delays
     all other scripts in this tab and they will never be able to run at document-start. */
  lifetime: 60 * 60 * 1000,
});

Object.assign(commands, {
  CacheLoad(data) {
    return cache.get(data) || null;
  },
  CacheHit(data) {
    cache.hit(data.key, data.lifetime);
  },
  CachePop(key) {
    return cache.pop(key) || null;
  },
});

export default cache;
