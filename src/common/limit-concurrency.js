import { makePause } from '@/common/index';

export default function limitConcurrency(fn, concurrency, delay) {
  const all = [];
  const processing = new Set();
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
    try {
      return await fn(...args);
    } finally {
      if (delay > 0) await makePause(delay);
      processing.delete(token);
      check();
    }
  };
}
