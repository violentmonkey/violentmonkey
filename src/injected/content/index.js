import { isEmpty, sendCmd, INJECT_CONTENT } from '../util';
import bridge from './bridge';
import './clipboard';
import { sendSetPopup } from './gm-api-content';
import { injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';

const { invokableIds, runningIds } = bridge;
const resolvedPromise = promiseResolve();
let badgePromise;
let numBadgesSent = 0;
let bfCacheWired;

// Make sure to call obj::method() in code that may run after INJECT_CONTENT userscripts
(async () => {
  const contentId = getUniqIdSafe();
  const webId = getUniqIdSafe();
  // injecting right now before site scripts can mangle globals or intercept our contentId
  // except for XML documents as their appearance breaks, but first we're sending
  // a request for the data because injectPageSandbox takes ~5ms
  const dataPromise = sendCmd('GetInjected',
    /* In FF93 sender.url is wrong: https://bugzil.la/1734984,
     * in Chrome sender.url is ok, but location.href is wrong for text selection URLs #:~:text= */
    IS_FIREFOX && global.location.href,
    { retry: true });
  const isXml = document instanceof XMLDocument;
  if (!isXml) injectPageSandbox(contentId, webId);
  // detecting if browser.contentScripts is usable, it was added in FF59 as well as composedPath
  const data = IS_FIREFOX && Event[PROTO].composedPath
    ? await getDataFF(dataPromise)
    : await dataPromise;
  const { allowCmd } = bridge;
  allowCmd('VaultId', contentId);
  bridge::pickIntoThis(data, [
    'ids',
    'injectInto',
  ]);
  if (data.expose) {
    allowCmd('GetScriptVer', contentId);
    bridge.addHandlers({ GetScriptVer: true }, true);
    bridge.post('Expose');
  }
  if (data.scripts) {
    bridge.onScripts.forEach(fn => fn(data));
    allowCmd('SetTimeout', contentId);
    if (IS_FIREFOX) allowCmd('InjectList', contentId);
    await injectScripts(contentId, webId, data);
  }
  bridge.onScripts = null;
  sendSetPopup();
})().catch(IS_FIREFOX && console.error); // Firefox can't show exceptions in content scripts

bridge.addBackgroundHandlers({
  Command(data) {
    const realm = invokableIds::includes(data.id) && INJECT_CONTENT;
    bridge.post('Command', data, realm);
  },
  UpdatedValues(data) {
    const dataPage = createNullObj();
    const dataContent = createNullObj();
    objectKeys(data)::forEach((id) => {
      (invokableIds::includes(+id) ? dataContent : dataPage)[id] = data[id];
    });
    if (!isEmpty(dataPage)) bridge.post('UpdatedValues', dataPage);
    if (!isEmpty(dataContent)) bridge.post('UpdatedValues', dataContent, INJECT_CONTENT);
  },
});

bridge.addHandlers({
  Run(id, realm) {
    runningIds::push(id);
    bridge.ids::push(id);
    if (realm === INJECT_CONTENT) {
      invokableIds::push(id);
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
  },
  SetTimeout: true,
  TabFocus: true,
  UpdateValue: true,
});

function throttledSetBadge() {
  const num = runningIds.length;
  if (numBadgesSent < num) {
    numBadgesSent = num;
    return sendCmd('SetBadge', runningIds)::then(() => {
      badgePromise = throttledSetBadge();
    });
  }
}

async function getDataFF(viaMessaging) {
  // In Firefox we set data on global `this` which is not equal to `window`
  const data = global.vmData || await PromiseSafe.race([
    new PromiseSafe(resolve => { global.vmResolve = resolve; }),
    viaMessaging,
  ]);
  delete global.vmResolve;
  delete global.vmData;
  return data;
}
