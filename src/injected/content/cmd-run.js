import bridge, { addHandlers, onScripts } from './bridge';
import { sendSetPopup } from './gm-api-content';
import { nextTask, sendCmd } from './util';

const getPersisted = describeProperty(PageTransitionEvent[PROTO], 'persisted').get;
let pending = topRenderMode === 2; // wait until reified if pre-rendered
let resolveOnReify;
let runningIds;
let sent;

onScripts.push(() => {
  addHandlers({ Run });
  runningIds = [];
});
on('pageshow', onShown);
if (pending) {
  document::on('prerenderingchange', onShown.bind(null), { once: true });
  bridge[REIFY] = new Promise(resolve => (resolveOnReify = resolve));
}

function onShown(evt) {
  // isTrusted is `unforgeable` per DOM spec
  if (evt.isTrusted) {
    if (!this) {
      topRenderMode = 3; // eslint-disable-line no-global-assign
      sent = bridge[REIFY] = false;
      resolveOnReify();
      report();
      topRenderMode = 4; // eslint-disable-line no-global-assign
    } else if (evt::getPersisted()) {
      report(0, 'bfcache');
    }
  }
}

export function Run(id, realm) {
  safePush(runningIds, id);
  bridge[IDS][id] = realm || PAGE;
  if (!pending) pending = report(2);
}

async function report(delay, reset = !sent) {
  while (--delay >= 0) await nextTask();
  // not awaiting to clear `pending` immediately
  sendCmd('Run', { reset, [IDS]: runningIds });
  sendSetPopup(!!pending);
  pending = false;
  sent = true;
}

export function finish(injectInto) {
  if (pending || sent) return;
  if (injectInto === SKIP_SCRIPTS || injectInto === 'off') {
    runningIds = injectInto;
  }
  report();
}
