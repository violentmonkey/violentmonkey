import browser from '@/common/browser';
import { sendCmdDirectly } from '@/common';
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
    const idMap = data.ids::mapEntry(null, (id, val, _) => (_ = store.idMap[id]) !== val
      && (_ == null || isTop || val === ID_BAD_REALM || val === ID_INJECTING)
      && id);
    const ids = Object.keys(idMap).map(Number);
    Object.assign(store.idMap, idMap);
    if (isTop) {
      mutex.resolve();
      store.commands = data.menus::mapEntry(Object.keys);
      // executeScript may(?) fail in a discarded or lazy-loaded tab, which is actually injectable
      store.injectable = true;
    }
    if (ids.length) {
      // frameScripts may be appended multiple times if iframes have unique scripts
      const scope = store[isTop ? 'scripts' : 'frameScripts'];
      const metas = data.scripts?.filter(({ props: { id } }) => ids.includes(id))
        || (Object.assign(data, await sendCmdDirectly('GetData', { ids }))).scripts;
      metas.forEach(script => {
        loadScriptIcon(script, data);
        const { id } = script.props;
        const state = idMap[id];
        const badRealm = state === ID_BAD_REALM;
        const renderedScript = scope.find(({ props }) => props.id === id);
        if (renderedScript) script = renderedScript;
        else scope.push(script);
        script.runs = state === INJECT_CONTENT || state === INJECT_PAGE;
        script.pageUrl = url; // each frame has its own URL
        script.failed = badRealm || state === ID_INJECTING;
        if (badRealm && !store.injectionFailure) {
          store.injectionFailure = { fixable: data[INJECT_INTO] === INJECT_PAGE };
        }
      });
    }
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

Promise.all([
  sendCmdDirectly('GetTabDomain'),
  browser.tabs.executeScript({ code: '1', runAt: 'document_start' }).catch(() => []),
])
.then(async ([
  { tab, domain },
  [injectable],
]) => {
  store.currentTab = tab;
  store.domain = domain;
  browser.runtime.connect({ name: `${tab.id}` });
  if (!injectable) {
    store.injectable = false;
    mutex.resolve();
  } else {
    store.blacklisted = await sendCmdDirectly('TestBlacklist', tab.url);
  }
});
