import initCache from '@/common/cache';
import { commands } from './message';

const cache = initCache({
  lifetime: 5 * 60 * 1000,
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
