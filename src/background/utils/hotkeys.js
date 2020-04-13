import { postInitialize } from './init';
import { commands } from './message';

const ROUTES = {
  newScript: '#scripts/_new',
  settings: '#settings',
};

postInitialize.push(() => {
  browser.commands.onCommand.addListener((cmd) => {
    commands.TabOpen({
      url: `${browser.runtime.getManifest().options_ui.page}${ROUTES[cmd] || ''}`,
    });
  });
});
