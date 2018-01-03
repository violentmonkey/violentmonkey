import 'src/common/browser';
import Vue from 'vue';
import { i18n, sendMessage } from 'src/common';
import handlers from 'src/common/handlers';
import * as tld from 'src/common/tld';
import 'src/common/ui/style';
import App from './views/app';
import { store } from './utils';

tld.initTLD();

Vue.prototype.i18n = i18n;

new Vue({
  render: h => h(App),
}).$mount('#app');

Object.assign(handlers, {
  SetPopup(data, src) {
    if (store.currentTab.id !== src.tab.id) return;
    store.commands = data.menus;
    sendMessage({
      cmd: 'GetMetas',
      data: data.ids,
    })
    .then(scripts => {
      store.scripts = scripts;
    });
  },
});

browser.tabs.query({ currentWindow: true, active: true })
.then(tabs => {
  const currentTab = {
    id: tabs[0].id,
    url: tabs[0].url,
  };
  store.currentTab = currentTab;
  browser.tabs.sendMessage(currentTab.id, { cmd: 'GetPopup' });
  if (/^https?:\/\//i.test(currentTab.url)) {
    const matches = currentTab.url.match(/:\/\/([^/]*)/);
    const domain = matches[1];
    const topLevelDomain = tld.getDomain(domain) || domain;
    let domains = [topLevelDomain];
    if (domain !== topLevelDomain) {
      domains = domain.slice(0, -topLevelDomain.length - 1).split('.')
      .reduceRight(
        (res, part) => [`${part}.${res[0]}`, ...res],
        domains,
      );
    }
    store.domains = domains;
  }
});
