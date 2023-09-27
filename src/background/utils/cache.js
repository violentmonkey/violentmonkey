import initCache from '@/common/cache';
import { addOwnCommands } from './init';

const cache = initCache({
  lifetime: 5 * 60 * 1000,
});

addOwnCommands({
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
