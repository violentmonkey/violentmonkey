import { makePause } from '@/common/index';

export default function limitConcurrency(fn, concurrency, delay) {
  const all = [];
  const processing = new Set();
  let lastRun;
  async function enqueue() {
    let token;
    let promise = new Promise(resolve => { token = resolve; });
    all.push(token);
    check();
    await promise;
    return token;
  }
  function check() {
    while (all.length && processing.size < concurrency) {
      const token = all.shift();
      processing.add(token);
      token();
    }
  }
  return async function limitConcurrencyRunner(...args) {
    const token = await enqueue();
    if (delay > 0 && lastRun) {
      await makePause(delay - (performance.now() - lastRun));
    }
    try {
      return await fn(...args);
    } finally {
      lastRun = performance.now();
      processing.delete(token);
      check();
    }
  };
}
