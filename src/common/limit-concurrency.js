import { makePause } from '@/common/index';

/**
 * @param {function} fn
 * @param {number} max
 * @param {number} diffKeyDelay
 * @param {number} sameKeyDelay
 * @param {function(...args): string} getKey
 * @return {function(...args): Promise}
 */
function limitConcurrency(fn, max, diffKeyDelay, sameKeyDelay, getKey) {
  const keyPromise = {};
  const keyTime = {};
  const pool = new Set();
  const maxDelay = Math.max(diffKeyDelay, sameKeyDelay);
  let lastTime, lastKey;
  return async function limiter(...args) {
    // Looping because the oldest awaiting instance will immediately add to `pool`
    while (pool.size === max) await Promise.race(pool);
    let resolve, t;
    const key = getKey(...args);
    const old = keyPromise[key];
    const promise = keyPromise[key] = new Promise(cb => { resolve = cb; }).catch(console.warn);
    if (old) await old;
    if (key === lastKey) {
      t = keyTime[key];
      t = maxDelay - (t ? performance.now() - t : 0);
    } else if (lastTime) {
      t = diffKeyDelay - (performance.now() - lastTime);
    }
    if (t > 0) await makePause(t);
    try {
      pool.add(promise);
      return await fn(...args);
    } finally {
      pool.delete(promise);
      delete keyPromise[key];
      lastTime = keyTime[key] = performance.now();
      lastKey = key;
      resolve();
    }
  };
}

export default limitConcurrency;
