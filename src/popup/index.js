import '@/common/browser';
import { sendCmdDirectly } from '@/common';
import { INJECTABLE_TAB_URL_RE } from '@/common/consts';
import handlers from '@/common/handlers';
import { loadScriptIcon } from '@/common/load-script-icon';
import { forEachValue, mapEntry } from '@/common/object';
import { render } from '@/common/ui';
import '@/common/ui/style';
import App from './views/app';
import { mutex, store } from './utils';

mutex.init();

render(App);

Object.assign(handlers, {
  async SetPopup(data, { frameId, tab, url }) {
    // No `tab` is a FF bug when it sends messages from removed iframes
    if (!tab || store.currentTab && store.currentTab.id !== tab.id) return;
    /* SetPopup from a sub-frame may come first so we need to wait for the main page
     * because we only show the iframe menu for unique scripts that don't run in the main page */
    const isTop = frameId === 0;
    if (!isTop) await mutex.ready;
    else {
      store.commands = data.menus::mapEntry(Object.keys);
      // executeScript may(?) fail in a discarded or lazy-loaded tab, which is actually injectable
      store.injectable = true;
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

sendCmdDirectly('CachePop', 'SetPopup').then((data) => {
  data::forEachValue(val => handlers.SetPopup(...val));
});

/* Since new Chrome prints a warning when ::-webkit-details-marker is used,
 * we add it only for old Chrome, which is detected via feature added in 89. */
if (!CSS.supports?.('list-style-type', 'disclosure-open')) {
  document.styleSheets[0].insertRule('.excludes-menu ::-webkit-details-marker {display:none}');
}

sendCmdDirectly('GetTabDomain').then(async ({ tab, domain }) => {
  store.currentTab = tab;
  store.domain = domain;
  browser.runtime.connect({ name: `${tab.id}` });
  if (!INJECTABLE_TAB_URL_RE.test(tab.url) // executeScript runs code in own pages in FF
  || !await browser.tabs.executeScript({ code: '1', [RUN_AT]: 'document_start' }).catch(() => [])) {
    store.injectable = false;
    mutex.resolve();
  } else {
    store.blacklisted = await sendCmdDirectly('TestBlacklist', tab.url);
  }
});
