import { makePause } from '@/common/index';

/**
 * @param {function} fn
 * @param {number} max
 * @param {number} diffKeyDelay
 * @param {number} sameKeyDelay
 * @param {function(...args: any[]): string} getKey
 * @return {function(...args: any[]): Promise}
 */
function limitConcurrency(fn, max, diffKeyDelay, sameKeyDelay, getKey) {
  const keyPromise = {};
  const keyTime = {};
  const pool = new Set();
  const maxDelay = Math.max(diffKeyDelay, sameKeyDelay);
  let lastTime, lastKey;
  return async function limiter(...args) {
    let resolve, t;
    const key = getKey(...args);
    const old = keyPromise[key];
    const promise = keyPromise[key] = new Promise(cb => { resolve = cb; }).catch(console.warn);
    if (old) await old;
    // Looping because the oldest awaiting instance will immediately add to `pool`
    while (pool.size === max) await Promise.race(pool);
    pool.add(promise);
    if (key === lastKey) {
      t = keyTime[key];
      t = maxDelay - (t ? performance.now() - t : 0);
    } else if (lastTime) {
      t = diffKeyDelay - (performance.now() - lastTime);
    }
    if (t > 0) await makePause(t);
    try {
      lastKey = key;
      return await fn(...args);
    } finally {
      pool.delete(promise);
      if (keyPromise[key] === promise) delete keyPromise[key];
      lastTime = keyTime[key] = performance.now();
      resolve();
    }
  };
}

export default limitConcurrency;
