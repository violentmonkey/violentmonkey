import {
  INJECT_AUTO,
  INJECT_CONTENT,
  INJECT_MAPPING,
  INJECT_PAGE,
  browser,
} from '#/common/consts';
import { sendCmd } from '#/common';
import { defineProperty, forEachKey, objectPick } from '#/common/object';
import {
  append, appendChild, createElementNS, elemByTag, remove, NS_HTML,
  addEventListener, removeEventListener,
  log,
} from '../utils/helpers';
import bridge from './bridge';

// Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
const VMInitInjection = window[process.env.INIT_FUNC_NAME];
// To avoid running repeatedly due to new `document.documentElement`
// (the prop is undeletable so a userscript can't fool us on reinjection)
defineProperty(window, process.env.INIT_FUNC_NAME, { value: 1 });

const stringIncludes = String.prototype.includes;

let contLists;
let pgLists;
let realms;

bridge.addHandlers({
  // FF bug workaround to enable processing of sourceURL in injected page scripts
  InjectList: injectList,
});

function appendToRoot(node) {
  // DOM spec allows any elements under documentElement
  // https://dom.spec.whatwg.org/#node-trees
  const root = elemByTag('head') || elemByTag('*');
  return root && root::appendChild(node);
}

export function injectPageSandbox(contentId, webId) {
  inject({
    code: `(${VMInitInjection}())('${webId}','${contentId}')\n//# sourceURL=${
      browser.runtime.getURL('sandbox/injected-web.js')
    }`,
  });
}

export function injectScripts(contentId, webId, data, isXml) {
  bridge.ids = data.ids;
  // eslint-disable-next-line prefer-rest-params
  if (!elemByTag('*')) return onElement('*', injectScripts, ...arguments);
  let injectable = isXml ? false : null;
  const bornReady = ['interactive', 'complete'].includes(document.readyState);
  const info = objectPick(data, ['cache', 'isFirefox', 'ua']);
  realms = {
    [INJECT_CONTENT]: {
      injectable: () => true,
      lists: contLists = { start: [], body: [], end: [], idle: [] },
      ids: [],
      info,
    },
    [INJECT_PAGE]: {
      // eslint-disable-next-line no-return-assign
      injectable: () => injectable ?? (injectable = checkInjectable()),
      lists: pgLists = { start: [], body: [], end: [], idle: [] },
      ids: [],
      info,
    },
  };
  sendCmd('InjectionFeedback', data.scripts.map((script) => {
    const { custom, dataKey, meta, props: { id } } = script;
    const desiredRealm = custom.injectInto || meta.injectInto || data.injectInto;
    const internalRealm = INJECT_MAPPING[desiredRealm] || INJECT_MAPPING[INJECT_AUTO];
    const realm = internalRealm.find(key => realms[key]?.injectable());
    let needsInjection;
    // If the script wants this specific realm, which is unavailable, we won't inject it at all
    if (realm) {
      const { ids, lists } = realms[realm];
      let runAt = bornReady ? 'start'
        : `${custom.runAt || meta.runAt || ''}`.replace(/^document-/, '');
      const list = lists[runAt] || lists[runAt = 'end'];
      needsInjection = realm === INJECT_CONTENT;
      script.stage = needsInjection && runAt !== 'start' && runAt;
      ids.push(id);
      list.push(script);
    } else {
      bridge.failedIds.push(id);
    }
    return [dataKey, needsInjection];
  }));
  setupContentInvoker(contentId, webId);
  injectAll('start');
  if (pgLists.body[0] || contLists.body[0]) {
    onElement('body', injectAll, 'body');
  }
  if (pgLists.idle[0] || contLists.idle[0] || pgLists.end[0] || contLists.end[0]) {
    document::addEventListener('DOMContentLoaded', () => {
      injectAll('end');
      injectAll('idle');
    }, { once: true });
  }
}

function checkInjectable() {
  let res = false;
  bridge.addHandlers({
    Pong() {
      res = true;
    },
  });
  bridge.post('Ping');
  return res;
}

function inject(item) {
  const script = document::createElementNS(NS_HTML, 'script');
  // Firefox ignores sourceURL comment when a syntax error occurs so we'll print the name manually
  let onError;
  if (bridge.isFirefox) {
    onError = e => {
      const { stack } = e.error;
      if (typeof stack === 'string' && stack::stringIncludes(browser.runtime.getURL('/sandbox'))) {
        log('error', [item.displayName], e.error);
        e.preventDefault();
      }
    };
    window::addEventListener('error', onError);
  }
  // using a safe call to an existing method so we don't have to extract textContent setter
  script::append(item.code);
  // When using declarativeContent there's no documentElement so we'll append to `document`
  if (!appendToRoot(script)) document::appendChild(script);
  if (onError) window::removeEventListener('error', onError);
  script::remove();
}

function injectAll(runAt) {
  const isStart = runAt === 'start';
  // Not using destructuring of arrays because we don't know if @@iterator is safe.
  realms::forEachKey((realm) => {
    const realmData = realms[realm];
    const isPage = realm === INJECT_PAGE;
    realmData.lists::forEachKey((name) => {
      const items = realmData.lists[name];
      // All lists for content mode are processed jointly when runAt='start'
      if ((isPage ? name === runAt : isStart) && items.length) {
        bridge.post('ScriptData', { items, runAt: name, info: realmData.info }, realm);
        realmData.info = undefined;
        if (isPage && !bridge.isFirefox) {
          injectList(runAt);
        }
      }
    });
  });
  if (!isStart && contLists[runAt].length) {
    bridge.post('RunAt', runAt, INJECT_CONTENT);
  }
  if (runAt === 'idle') {
    realms = null;
    pgLists = null;
    contLists = null;
  }
}

async function injectList(runAt) {
  const isIdle = runAt === 'idle';
  const list = pgLists[runAt];
  // Not using for-of because we don't know if @@iterator is safe.
  for (let i = 0; i < list.length; i += 1) {
    if (isIdle) await sendCmd('SetTimeout', 0);
    inject(list[i]);
  }
}

function onElement(tag, cb, ...args) {
  if (elemByTag(tag)) {
    cb(...args);
  } else {
    // This function runs before any userscripts, but MutationObserver callback may run
    // after content-mode userscripts so we'll have to use safe calls there
    const { disconnect } = MutationObserver.prototype;
    const observer = new MutationObserver(() => {
      if (elemByTag(tag)) {
        observer::disconnect();
        cb(...args);
      }
    });
    // documentElement may be replaced so we'll observe the entire document
    observer.observe(document, { childList: true, subtree: true });
  }
}

function setupContentInvoker(contentId, webId) {
  const invokableIds = realms[INJECT_CONTENT].ids;
  if (invokableIds.length) {
    const invoke = {
      [INJECT_CONTENT]: VMInitInjection()(webId, contentId, bridge.onHandle),
    };
    const postViaBridge = bridge.post;
    bridge.invokableIds = invokableIds;
    bridge.post = (cmd, params, realm) => (invoke[realm] || postViaBridge)(cmd, params);
  }
}
