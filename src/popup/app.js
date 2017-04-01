import Vue from 'vue';
import 'src/common/sprite';
import options from 'src/common/options';
import { i18n, sendMessage } from 'src/common';
import App from './views/app';
import { store } from './utils';

Vue.prototype.i18n = i18n;

new Vue({
  render: h => h(App),
}).$mount('#app');

const handlers = {
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
  UpdateOptions(data) {
    options.update(data);
  },
};
browser.runtime.onMessage.addListener((req, src, callback) => {
  const func = handlers[req.cmd];
  if (func) func(req.data, src, callback);
});

browser.tabs.query({ currentWindow: true, active: true })
.then(tabs => {
  const currentTab = {
    id: tabs[0].id,
    url: tabs[0].url,
  };
  store.currentTab = currentTab;
  browser.tabs.sendMessage(currentTab.id, { cmd: 'GetPopup' });
  if (currentTab && /^https?:\/\//i.test(currentTab.url)) {
    const matches = currentTab.url.match(/:\/\/(?:www\.)?([^/]*)/);
    const domain = matches[1];
    const domains = domain.split('.').reduceRight((res, part) => {
      const last = res[0];
      res.unshift(last ? `${part}.${last}` : part);
      return res;
    }, []);
    if (domains.length) domains.pop();
    store.domains = domains;
  }
});
