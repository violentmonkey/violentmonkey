import '@/common/browser';
import { sendCmdDirectly } from '@/common';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import { mapEntry } from '@/common/object';
import { render } from '@/common/ui';
import '@/common/ui/style';
import App from './views/app';
import { mutex, store } from './utils';

mutex.init();

render(App);

Object.assign(handlers, {
  async SetPopup(data, { frameId, tab, url }) {
    // No `tab` is a FF bug when it sends messages from removed iframes
    if (!tab || store.tab && store.tab.id !== tab.id) return;
    /* SetPopup from a sub-frame may come first so we need to wait for the main page
     * because we only show the iframe menu for unique scripts that don't run in the main page */
    const isTop = frameId === 0;
    if (!isTop) await mutex.ready;
    else {
      store.commands = data.menus::mapEntry(Object.keys);
    }
    const idMapAllFrames = store.idMap;
    const idMapMain = idMapAllFrames[0] || (idMapAllFrames[0] = {});
    const idMapOld = idMapAllFrames[frameId] || (idMapAllFrames[frameId] = {});
    const idMap = data[IDS]::mapEntry(null, (id, val) => val !== idMapOld[id] && id);
    const ids = Object.keys(idMap).map(Number);
    if (ids.length) {
      Object.assign(idMapOld, idMap);
      // frameScripts may be appended multiple times if iframes have unique scripts
      const scope = store[isTop ? SCRIPTS : 'frameScripts'];
      const metas = data[SCRIPTS]?.filter(({ props: { id } }) => ids.includes(id))
        || (Object.assign(data, await sendCmdDirectly('GetData', { ids })))[SCRIPTS];
      metas.forEach(script => {
        loadScriptIcon(script, data);
        const { id } = script.props;
        const state = idMap[id];
        const badRealm = state === ID_BAD_REALM;
        const renderedScript = scope.find(({ props }) => props.id === id);
        if (renderedScript) script = renderedScript;
        else if (isTop || !(id in idMapMain)) {
          scope.push(script);
          if (isTop) { // removing script from frameScripts if it ran there before the main frame
            const { frameScripts } = store;
            const i = frameScripts.findIndex(({ props }) => props.id === id);
            if (i >= 0) frameScripts.splice(i, 1);
          }
        }
        script.runs = state === CONTENT || state === PAGE;
        script.pageUrl = url; // each frame has its own URL
        script.failed = badRealm || state === ID_INJECTING;
        script.syntax = state === ID_INJECTING;
        if (badRealm && !store.injectionFailure) {
          store.injectionFailure = { fixable: data[INJECT_INTO] === PAGE };
        }
      });
    }
    if (isTop) mutex.resolve(); // resolving at the end after all `await` above are settled
  },
});

/* Since new Chrome prints a warning when ::-webkit-details-marker is used,
 * we add it only for old Chrome, which is detected via feature added in 89. */
if (!CSS.supports?.('list-style-type', 'disclosure-open')) {
  document.styleSheets[0].insertRule('.excludes-menu ::-webkit-details-marker {display:none}');
}

sendCmdDirectly('InitPopup').then(([cached, data, [failure, reason, reason2]]) => {
  if (cached) {
    for (const id in cached) handlers.SetPopup(...cached[id]);
  }
  if (!reason) {
    // ignore
  } else if (reason === INJECT_INTO) {
    reason = 'noninjectable';
    data.injectable = false;
    mutex.resolve();
  } else if (reason === SKIP_SCRIPTS) {
    reason = 'scripts-skipped';
    data.skipped = true;
  } else if (reason === IS_APPLIED) {
    reason = 'scripts-disabled';
  } else { // blacklisted
    data[reason] = reason2;
  }
  data.failure = reason;
  data.failureText = failure;
  Object.assign(store, data);
  browser.runtime.connect({ name: `${data.tab.id}` });
});
