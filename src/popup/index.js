import Vue from 'vue';
import { i18n, sendMessage } from '#/common';
import handlers from '#/common/handlers';
import * as tld from '#/common/tld';
import '#/common/ui/style';
import App from './views/app';
import { store } from './utils';

tld.initTLD();

Vue.prototype.i18n = i18n;

waitForBody()
.then((body) => {
  new Vue({
    render: h => h(App),
  })
  .$mount(body.appendChild(document.createElement('div')));
});

Object.assign(handlers, {
  SetPopup(data, src) {
    if (store.currentTab.id !== src.tab.id) return;
    const { menus } = data;
    store.commands = Object.entries(menus)
    .reduce((map, [id, values]) => {
      map[id] = Object.keys(values).sort();
      return map;
    }, {});
    sendMessage({
      cmd: 'GetMetas',
      data: data.ids,
    })
    .then((scripts) => {
      store.scripts = scripts;
    });
  },
});

browser.tabs.query({ currentWindow: true, active: true })
.then((tabs) => {
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
});

function waitForBody() {
  return Promise.resolve(document.body || new Promise((resolve) => {
    new MutationObserver(((_mutations, observer) => {
      if (document.body) {
        observer.disconnect();
        resolve(document.body);
      }
    })).observe(document.documentElement, { childList: true });
  }));
}
