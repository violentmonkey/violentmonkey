import bridge from './bridge';
import { sendCmd } from './util';
import { INJECT_CONTENT } from '../util';

const { runningIds } = bridge;
const resolvedPromise = promiseResolve();
let badgePromise;
let numBadgesSent = 0;
let bfCacheWired;

export function Run(id, realm) {
  safePush(runningIds, id);
  safePush(bridge.ids, id);
  if (realm === INJECT_CONTENT) {
    safePush(bridge.invokableIds, id);
  }
  if (!badgePromise) {
    badgePromise = resolvedPromise::then(throttledSetBadge);
  }
  if (!bfCacheWired) {
    bfCacheWired = true;
    window::on('pageshow', evt => {
      // isTrusted is `unforgeable` per DOM spec so we don't need to safeguard its getter
      if (evt.isTrusted && evt.persisted) {
        sendCmd('SetBadge', runningIds);
      }
    });
  }
}

function throttledSetBadge() {
  const num = runningIds.length;
  if (numBadgesSent < num) {
    numBadgesSent = num;
    return sendCmd('SetBadge', runningIds)::then(() => {
      badgePromise = throttledSetBadge();
    });
  }
}
