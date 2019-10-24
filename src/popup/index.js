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

Object.assign(handlers, {
  SetPopup(data, src) {
    if (store.currentTab.id !== src.tab.id) return;
    store.commands = Object.entries(data.menus)
    .reduce((map, [id, values]) => {
      map[id] = Object.keys(values).sort();
      return map;
    }, {});
    sendCmd('GetMetas', data.ids)
    .then((scripts) => {
      store.scripts = scripts;
    });
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
