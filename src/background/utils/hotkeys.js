import { commands } from './init';
import { reloadAndSkipScripts } from './preinject';
import { openDashboard } from './tabs';

browser.commands?.onCommand.addListener(cmd => {
  if (cmd === 'newScript') {
    commands.OpenEditor();
  } else if (cmd === SKIP_SCRIPTS) {
    reloadAndSkipScripts();
  } else {
    openDashboard(cmd === TAB_SETTINGS ? cmd : '');
  }
});
