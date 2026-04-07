import '@/common/browser';
import { i18n, sendCmdDirectly } from '@/common';
import handlers from '@/common/handlers';
import { loadCommandIcon, loadScriptIcon } from '@/common/load-script-icon';
import { mapEntry } from '@/common/object';
import { render } from '@/common/ui';
import '@/common/ui/style';
import App from './views/app';
import { emptyStore, isFullscreenPopup, store } from './utils';

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
  if (data.errors) {
    store.failure = 'injection-error';
    store.failureText = data.errors;
    store.injectionFailure = {
      ...store.injectionFailure,
      fixable: !!store.injectionFailure?.fixable,
      text: data.errors,
    };
  }
  /* SetPopup from a sub-frame may come first so we need to wait for the main page
   * because we only show the iframe menu for unique scripts that don't run in the main page */
  const isTop = frameId === 0;
  if (!data[MORE]) {
    const moreIds = await sendCmdDirectly('GetMoreIds', {
      url,
      [kTop]: isTop,
      [IDS]: data[IDS],
    }).catch(err => {
      if (process.env.DEBUG) console.warn('GetMoreIds failed:', err);
      return {};
    });
    Object.assign(data[IDS], moreIds);
  }
  if (!isTop) await mutex;
  else {
    store[IS_APPLIED] = data[INJECT_INTO] !== 'off'; // isApplied at the time of GetInjected
  }
  // Ensuring top script's menu wins over a per-frame menu with different commands
  const commands = store.commands = Object.assign(data.menus || {}, !isTop && store.commands);
  const idMapAllFrames = store.idMap;
  const idMapMain = idMapAllFrames[0] || (idMapAllFrames[0] = {});
  const idMapOld = idMapAllFrames[frameId] || (idMapAllFrames[frameId] = {});
  const idMap = (data[IDS] || {})::mapEntry(null, (id, val) => val !== idMapOld[id] && id);
  const ids = Object.keys(idMap).map(Number);
  if (ids.length) {
    Object.assign(idMapOld, idMap);
    // frameScripts may be appended multiple times if iframes have unique scripts
    const { frameScripts } = store;
    const scope = isTop ? store[SCRIPTS] : frameScripts;
    const { grantless } = data;
    let metas = data[SCRIPTS]?.filter(({ props: { id } }) => ids.includes(id)) || [];
    if (!metas.length) {
      Object.assign(data, await sendCmdDirectly('GetData', { ids }).catch(() => ({})));
      metas = data[SCRIPTS] || [];
    }
    metas.forEach(script => {
      loadScriptIcon(script, data);
      let v;
      const { id } = script.props;
      const state = idMap[id];
      const more = state === MORE;
      const badRealm = state === ID_BAD_REALM;
      const renderedScript = scope.find(({ props }) => props.id === id);
      if (renderedScript) script = renderedScript;
      else if (isTop || !(id in idMapMain)) {
        scope.push(script);
        if (isTop) { // removing script from frameScripts if it ran there before the main frame
          const i = frameScripts.findIndex(({ props }) => props.id === id);
          if (i >= 0) frameScripts.splice(i, 1);
        }
      }
      script.runs = state === CONTENT || state === PAGE;
      script.pageUrl = url; // each frame has its own URL
      script.failed = badRealm || state === ID_INJECTING || more;
      if (grantless && (v = grantless[id]) && delete v.window && (v = Object.keys(v).join(', '))) {
        script.grantless = i18n('hintGrantless', v.length > 50 ? v.slice(0, 50) + '...' : v);
      }
      script[MORE] = more;
      script.syntax = state === ID_INJECTING && !data.errors;
      if (badRealm && !store.injectionFailure) {
        store.injectionFailure = { fixable: data[INJECT_INTO] === PAGE };
      }
    });
  }
  for (const scriptId in commands) {
    const scriptCommands = commands[scriptId];
    for (const id in scriptCommands) {
      loadCommandIcon(scriptCommands[id], store);
    }
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
  Object.assign(store, emptyStore());
  let [cached, data, [failure, reason, reason2]] = await sendCmdDirectly('InitPopup').catch(err => {
    // Service worker may not be ready yet, return default empty state
    if (process.env.DEBUG) console.warn('InitPopup failed:', err);
    return [null, { tab: { id: 0, url: '' }, scripts: [] }, ['', '', '']];
  });
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
    for (const id in cached) handlers.SetPopup(...cached[id]);
  }
  if (!port) {
    try {
      port = browser.runtime.connect({ name: `Popup:${cached ? 'C' : ''}:${data.tab.id}` });
      if (port) port.onMessage.addListener(onPortMessage);
    } catch (err) {
      if (process.env.DEBUG) console.warn('Port connection failed:', err);
      port = null;
    }
  }
}

function onPortMessage(message) {
  if (message?.cmd === 'SetPopup') {
    handlers.SetPopup(message.data, message.src);
  } else {
    initialize();
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
