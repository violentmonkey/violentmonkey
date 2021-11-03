import bridge from './bridge';
import './clipboard';
import { sendSetPopup } from './gm-api-content';
import { injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';
import { sendCmd } from './util-content';
import { isEmpty, INJECT_CONTENT } from '../util';

const { invokableIds, runningIds } = bridge;
const resolvedPromise = promiseResolve();
let badgePromise;
let numBadgesSent = 0;
let bfCacheWired;

// Make sure to call obj::method() in code that may run after INJECT_CONTENT userscripts
(async () => {
  const contentId = getUniqIdSafe();
  const webId = getUniqIdSafe();
  const dataPromise = sendCmd('GetInjected', {
    /* In FF93 sender.url is wrong: https://bugzil.la/1734984,
     * in Chrome sender.url is ok, but location.href is wrong for text selection URLs #:~:text= */
    url: IS_FIREFOX && global.location.href,
    // XML document's appearance breaks when script elements are added
    forceContent: document instanceof XMLDocument
    /* Don't autorun `page` mode userscripts when the extension was installed/updated in Firefox
     * since sites can spoof JS environment and easily impersonate a userscript in `page` mode. */
      || IS_FIREFOX && !isDocumentLoading()
      || !injectPageSandbox(contentId, webId),
  }, { retry: true });
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
