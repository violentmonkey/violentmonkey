import { i18n, sendCmdDirectly } from '@/common';
import handlers from '@/common/handlers';
import { loadCommandIcon, loadScriptIcon } from '@/common/load-script-icon';
import { render } from '@/common/ui';
import '@/common/ui/style';
import App from './views/app';
import { emptyStore, isFullscreenPopup, store } from './utils';

let idMapMain, idMapFrames;
let mutex, mutexResolve, port;
let hPrev;

initialize();
render(App);

Object.assign(handlers, {
  /** Must be synchronous to prevent the wrong visible popup from responding to the message */
  Run({ reset }, { [kFrameId]: frameId, tab }) {
    // The tab got reloaded so Run+reset comes right before SetPopup, see cmd-run.js
    if (reset && !frameId && isMyTab(tab)) {
      initialize();
    }
  },
  /** Must be synchronous to prevent the wrong visible popup from responding to the message */
  SetPopup(data, src) {
    if (isMyTab(src.tab)) {
      return setPopup(data, src);
    }
  },
});

async function setPopup(data, { [kFrameId]: frameId, url }) {
  /* SetPopup from a sub-frame may come first so we need to wait for the main page
   * because we only show the iframe menu for unique scripts that don't run in the main page */
  const isTop = frameId === 0;
  const dataIds = data[IDS];
  if (!data[MORE]) {
    Object.assign(dataIds, await sendCmdDirectly('GetMoreIds', {
      url,
      [kTop]: isTop,
      [IDS]: dataIds,
    }));
  }
  if (!isTop) await mutex;
  else {
    store[IS_APPLIED] = data[INJECT_INTO] !== 'off'; // isApplied at the time of GetInjected
  }
  let v;
  const idMap = isTop ? idMapMain : idMapFrames;
  const ids = Object.keys(dataIds)
    .map(id => (v = dataIds[id]) !== idMap[id] && (idMap[id] = v, +id))
    .filter(Boolean);
  if (ids.length) {
    const scope = store[SCRIPTS][isTop ? 0 : 1];
    const { menus } = data;
    const { grantless } = data;
    const metas = data[SCRIPTS]?.filter(({ props: { id } }) => ids.includes(id))
      || (Object.assign(data, await sendCmdDirectly('GetData', { ids })))[SCRIPTS];
    metas.forEach(script => {
      const { id } = script.props;
      const state = idMap[id];
      const cmds = menus[id];
      const content = script.c = state === CONTENT && state;
      const more = state === MORE;
      const badRealm = state === ID_BAD_REALM;
      const renderedScript = scope.find(({ props }) => props.id === id);
      if (renderedScript) script = renderedScript;
      else if (isTop || !(id in idMapMain)) {
        script = scope[scope.push(script) - 1]; // get the Vue-proxified script
        if (isTop) { // removing script from frameScripts if it ran there before the main frame
          // frameScripts may be appended multiple times if iframes have unique scripts
          const frameScripts = store[SCRIPTS][1];
          const i = frameScripts.findIndex(({ props }) => props.id === id);
          if (i >= 0) frameScripts.splice(i, 1);
        }
      }
      script.runs = content || state === PAGE;
      script.pageUrl = url; // each frame has its own URL
      script.failed = badRealm || state === ID_INJECTING || more;
      if (grantless && (v = grantless[id]) && delete v.window && (v = Object.keys(v).join(', '))) {
        script.grantless = i18n('hintGrantless', v.length > 50 ? v.slice(0, 50) + '...' : v);
      }
      script[MORE] = more;
      script.syntax = state === ID_INJECTING;
      if (badRealm && !store.injectionFailure) {
        store.injectionFailure = { fixable: data[INJECT_INTO] === PAGE };
      }
      loadScriptIcon(script, data);
      if (cmds) {
        const menuScript = !isTop && id in idMapMain
          && store[SCRIPTS][0].find(({ props }) => props.id === id)
          || script;
        const menu = menuScript.cmds ||= new Map();
        for (const cmd in cmds) {
          if (!menu.has(cmd)) { // Adding new commands at the end
            v = cmds[cmd];
            menu.set(cmd, v);
            loadCommandIcon(v, store);
          }
        }
      }
    });
  }
  if (isTop) mutexResolve(); // resolving at the end after all `await` above are settled
  if (!hPrev) {
    hPrev = Math.max(innerHeight, 100); // ignore the not-yet-resized popup e.g. in Firefox
    window.onresize = onResize;
    // Mobile browsers show the popup maximized to the entire screen, no resizing
    if (isFullscreenPopup && hPrev > document.body.clientHeight) onResize();
  }
}

function initMutex(delay = 100) {
  mutex = new Promise(resolve => {
    mutexResolve = resolve;
    // pages like Chrome Web Store may forbid injection in main page so we need a timeout
    setTimeout(resolve, delay);
  });
}

async function initialize() {
  initMutex();
  idMapMain = {};
  idMapFrames = {};
  Object.assign(store, emptyStore());
  let [cached, data, [failure, reason, reason2]] = BGDATA.popup
    || await sendCmdDirectly('InitPopup');
  if (!reason) {
    failure = '';
  } else if (reason === INJECT_INTO) {
    reason = 'noninjectable';
    data.injectable = false;
    mutexResolve();
  } else if (reason === SKIP_SCRIPTS) {
    reason = 'scripts-skipped';
  } else if (reason === IS_APPLIED) {
    reason = 'scripts-disabled';
  } else { // blacklisted
    data[reason] = reason2;
  }
  Object.assign(store, data, {
    failure: reason,
    failureText: failure,
  });
  if (cached) {
    for (const id in cached) setPopup(...cached[id]);
  }
  if (!port) {
    port = browser.runtime.connect({ name: `Popup:${cached ? 'C' : ''}:${data.tab.id}` });
    port.onMessage.addListener(initialize); // for non-injectable tab
  }
}

function isMyTab(tab) {
  // No `tab` is a FF bug when it sends messages from removed iframes
  return tab && (!store.tab || store.tab.id === tab.id);
}

function onResize(evt) {
  const h = innerHeight;
  if (!evt
  // ignoring intermediate downsize
  || h > hPrev
  // ignoring  initial devicePixelRatio which is based on page zoom in this extension's tabs
    && document.readyState !== 'loading'
  // ignoring off-by-1 e.g. due to clientHeight being fractional
    && document.body.clientHeight - 1 > h
  ) {
    window.onresize = null;
    store.maxHeight = h + 'px';
  }
  hPrev = h;
}
