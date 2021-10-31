import { isEmpty, sendCmd } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import bridge from './bridge';
import './clipboard';
import { injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';
import { elemByTag } from './util-content';
import { NS_HTML, createNullObj, getUniqIdSafe, promiseResolve } from '../util';

const { invokableIds, runningIds } = bridge;
const menus = createNullObj();
const resolvedPromise = promiseResolve();
let ids;
let injectInto;
let badgePromise;
let numBadgesSent = 0;
let bfCacheWired;
let isPopupShown;
let pendingSetPopup;

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
  const { allow } = bridge;
  ids = data.ids;
  injectInto = data.injectInto;
  bridge.ids = ids;
  bridge.injectInto = injectInto;
  isPopupShown = data.isPopupShown;
  if (data.expose) {
    allow('GetScriptVer', contentId);
    bridge.addHandlers({ GetScriptVer: true }, true);
    bridge.post('Expose');
  }
  if (data.scripts) {
    bridge.onScripts.forEach(fn => fn());
    allow('SetTimeout', contentId);
    if (IS_FIREFOX) allow('InjectList', contentId);
    await injectScripts(contentId, webId, data);
  }
  allow('VaultId', contentId);
  bridge.onScripts = null;
  sendSetPopup();
})().catch(IS_FIREFOX && console.error); // Firefox can't show exceptions in content scripts

bridge.addBackgroundHandlers({
  PopupShown(state) {
    isPopupShown = state;
    sendSetPopup();
  },
}, true);

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
  RegisterMenu({ id, cap }) {
    if (IS_TOP) {
      const commandMap = menus[id] || (menus[id] = createNullObj());
      commandMap[cap] = 1;
      sendSetPopup(true);
    }
  },
  UnregisterMenu({ id, cap }) {
    if (IS_TOP) {
      delete menus[id]?.[cap];
      sendSetPopup(true);
    }
  },
  /** @this {Node} */
  AddElement({ tag, attrs, cbId }, realm) {
    let el;
    let res;
    try {
      const parent = this
        || /^(script|style|link|meta)$/i::regexpTest(tag) && elemByTag('head')
        || elemByTag('body')
        || elemByTag('*');
      el = document::createElementNS(NS_HTML, tag);
      if (attrs) {
        objectKeys(attrs)::forEach(key => {
          if (key === 'textContent') el::append(attrs[key]);
          else el::setAttribute(key, attrs[key]);
        });
      }
      parent::appendChild(el);
    } catch (e) {
      // A page-mode userscript can't catch DOM errors in a content script so we pass it explicitly
      // TODO: maybe move try/catch to bridge.onHandle and use bridge.sendSync in all web commands
      res = [`${e}`, e.stack];
    }
    bridge.post('Callback', { id: cbId, data: res }, realm, el);
  },
  Run(id, realm) {
    runningIds::push(id);
    ids::push(id);
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

async function sendSetPopup(isDelayed) {
  if (isPopupShown) {
    if (isDelayed) {
      if (pendingSetPopup) return;
      // Preventing flicker in popup when scripts re-register menus
      pendingSetPopup = sendCmd('SetTimeout', 0);
      await pendingSetPopup;
      pendingSetPopup = null;
    }
    sendCmd('SetPopup', {
      ids,
      injectInto,
      menus,
      runningIds,
      failedIds: bridge.failedIds,
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
