import 'src/common/browser';
import Vue from 'vue';
import { i18n } from 'src/common';
import 'src/common/handlers';
import options from 'src/common/options';
import 'src/common/ui/style';
import App from './views/app';
import './style.css';

Vue.prototype.i18n = i18n;
document.title = `${i18n('labelInstall')} - ${i18n('extName')}`;

options.ready(() => {
  new Vue({
    render: h => h(App),
  }).$mount('#app');
});
