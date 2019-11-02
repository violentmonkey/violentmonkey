import { mocker } from './base';

let time = 0;
let timers = [];

function tick(delta) {
  time += delta;
  let scheduledTimers = [];
  const filterTimer = ({ fn, ts, args }) => {
    if (time >= ts) {
      fn(...args);
      return false;
    }
    return true;
  };
  while (timers.length) {
    const processTimers = timers;
    timers = [];
    scheduledTimers = scheduledTimers.concat(processTimers.filter(filterTimer));
  }
  timers = scheduledTimers;
}

function now() {
  return time;
}

function setTimeout(fn, delta, ...args) {
  timers.push({ fn, ts: time + delta, args });
  return timers.length;
}

global.performance = { now };
global.Date.now = now;
global.setTimeout = setTimeout;

mocker.clock = { tick };
