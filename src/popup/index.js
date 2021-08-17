import Vue from 'vue';
import '#/common/browser';
import { i18n, sendCmdDirectly } from '#/common';
import { INJECT_PAGE } from '#/common/consts';
import handlers from '#/common/handlers';
import { loadScriptIcon } from '#/common/load-script-icon';
import { forEachValue, mapEntry } from '#/common/object';
import '#/common/ui/style';
import App from './views/app';
import { mutex, store } from './utils';

mutex.init();
Vue.prototype.i18n = i18n;

const vm = new Vue({
  render: h => h(App),
})
.$mount();
document.body.append(vm.$el);

Object.assign(handlers, {
  async SetPopup(data, src) {
    if (store.currentTab && store.currentTab.id !== src.tab.id) return;
    /* SetPopup from a sub-frame may come first so we need to wait for the main page
     * because we only show the iframe menu for unique scripts that don't run in the main page */
    const isTop = src.frameId === 0;
    if (!isTop) await mutex.ready;
    const ids = data.ids.filter(id => !store.scriptIds.includes(id));
    store.scriptIds.push(...ids);
    if (isTop) {
      mutex.resolve();
      store.commands = data.menus::mapEntry(([, value]) => Object.keys(value).sort());
      // executeScript may(?) fail in a discarded or lazy-loaded tab, which is actually injectable
      store.injectable = true;
    }
    if (ids.length) {
      // frameScripts may be appended multiple times if iframes have unique scripts
      const scope = store[isTop ? 'scripts' : 'frameScripts'];
      const metas = data.scripts?.filter(({ props: { id } }) => ids.includes(id))
        || (Object.assign(data, await sendCmdDirectly('GetData', ids))).scripts;
      metas.forEach(script => loadScriptIcon(script, data.cache));
      scope.push(...metas);
      data.failedIds.forEach(id => {
        scope.forEach((script) => {
          if (script.props.id === id) {
            script.failed = true;
            if (!store.injectionFailure) {
              store.injectionFailure = { fixable: data.injectInto === INJECT_PAGE };
            }
          }
        });
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
  } else {
    store.blacklisted = await sendCmdDirectly('TestBlacklist', tab.url);
  }
});
