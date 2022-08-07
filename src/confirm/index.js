import '@/common/browser';
import { i18n } from '@/common';
import '@/common/handlers';
import options from '@/common/options';
import { render } from '@/common/ui';
import '@/common/ui/favicon';
import '@/common/ui/style';
import App from './views/app';
import './style.css';

document.title = `${i18n('labelInstall')} - ${i18n('extName')}`;

options.ready.then(() => {
  render(App);
});
