import Vue from 'vue';
import '#/common/browser';
import { i18n } from '#/common';
import '#/common/handlers';
import options from '#/common/options';
import '#/common/ui/favicon';
import '#/common/ui/style';
import App from './views/app';
import './style.css';

Vue.prototype.i18n = i18n;
document.title = `${i18n('labelInstall')} - ${i18n('extName')}`;

options.ready.then(() => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  new Vue({
    render: h => h(App),
  })
  .$mount(el);
});
