import { getActiveTab } from '#/common';
import { commands } from './message';

const ROUTES = {
  newScript: '#scripts/_new',
  settings: '#settings',
};

global.addEventListener('backgroundInitialized', () => {
  browser.commands.onCommand.addListener(async (cmd) => {
    const tab = await getActiveTab();
    const optionsUrl = browser.runtime.getURL(browser.runtime.getManifest().options_ui.page);
    const url = `${optionsUrl}${ROUTES[cmd] || ''}`;
    commands.TabOpen({ url, insert: true }, { tab });
  });
}, { once: true });
