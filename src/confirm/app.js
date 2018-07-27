import '#/common/browser';
import Vue from 'vue';
import { i18n } from '#/common';
import '#/common/handlers';
import options from '#/common/options';
import '#/common/ui/style';
import App from './views/app';
import './style.css';

Vue.prototype.i18n = i18n;
document.title = `${i18n('labelInstall')} - ${i18n('extName')}`;

options.ready(() => {
  new Vue({
    render: h => h(App),
  }).$mount('#app');
});
