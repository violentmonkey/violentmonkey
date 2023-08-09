import bridge, { addHandlers, onScripts } from './bridge';
import { sendSetPopup } from './gm-api-content';
import { nextTask, sendCmd } from './util';

const getPersisted = describeProperty(PageTransitionEvent[PROTO], 'persisted').get;
let runningIds;
let pending;
let sent;

onScripts.push(() => {
  addHandlers({ Run });
  runningIds = [];
});
on('pageshow', evt => {
  // isTrusted is `unforgeable` per DOM spec
  if (evt.isTrusted && evt::getPersisted()) {
    sent = false;
    sendSetBadge();
  }
});

export function Run(id, realm) {
  safePush(runningIds, id);
  bridge[IDS][id] = realm || PAGE;
  if (!pending) pending = sendSetBadge(2);
}

export async function sendSetBadge(delayed) {
  if (delayed === AUTO && (pending || sent)) {
    return;
  }
  while (--delayed >= 0) {
    await nextTask();
  }
  // not awaiting to clear `pending` immediately
  sendCmd('SetBadge', { [IDS]: runningIds, reset: !sent });
  sendSetPopup(!!pending);
  pending = false;
  sent = true;
}

export function sendSkipScripts() {
  runningIds = SKIP_SCRIPTS;
  sendSetBadge();
}
