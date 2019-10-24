import Vue from 'vue';
import { i18n, sendCmd } from '#/common';
import { INJECTABLE_TAB_URL_RE } from '#/common/consts';
import handlers from '#/common/handlers';
import * as tld from '#/common/tld';
import '#/common/ui/style';
import App from './views/app';
import { store } from './utils';

tld.initTLD();

Vue.prototype.i18n = i18n;

const vm = new Vue({
  render: h => h(App),
})
.$mount();
document.body.append(vm.$el);

const allScriptIds = [];
// SetPopup from a sub-frame may come first so we need to wait for the main page
// because we only show the iframe menu for unique scripts that don't run in the main page
const mutex = {};
mutex.ready = new Promise(resolve => {
  mutex.resolve = resolve;
  // pages like Chrome Web Store may forbid injection in main page so we need a timeout
  setTimeout(resolve, 100);
});

Object.assign(handlers, {
  async SetPopup(data, src) {
    if (store.currentTab.id !== src.tab.id) return;
    const isTop = src.frameId === 0;
    const ids = isTop
      ? data.ids
      : (await mutex.ready, data.ids.filter(id => !allScriptIds.includes(id)));
    allScriptIds.push(...ids);
    if (isTop) {
      mutex.resolve();
      store.commands = Object.entries(data.menus)
      .reduce((map, [id, values]) => {
        map[id] = Object.keys(values).sort();
        return map;
      }, {});
    }
    if (ids.length) {
      // frameScripts may be appended multiple times if iframes have unique scripts
      store[isTop ? 'scripts' : 'frameScripts'].push(...await sendCmd('GetMetas', ids));
    }
  },
});

browser.tabs.query({ currentWindow: true, active: true })
.then(async (tabs) => {
  const currentTab = {
    id: tabs[0].id,
    url: tabs[0].url,
  };
  store.currentTab = currentTab;
  browser.tabs.sendMessage(currentTab.id, { cmd: 'GetPopup' });
  if (/^https?:\/\//i.test(currentTab.url)) {
    const matches = currentTab.url.match(/:\/\/([^/]*)/);
    const domain = matches[1];
    store.domain = tld.getDomain(domain) || domain;
  }
  if (!INJECTABLE_TAB_URL_RE.test(currentTab.url)) {
    store.injectable = false;
  } else {
    store.blacklisted = await sendCmd('TestBlacklist', currentTab.url);
  }
});
