import initCache from 'src/common/cache';

const cache = initCache();

export const getCache = cache.get;
export const setCache = cache.set;
