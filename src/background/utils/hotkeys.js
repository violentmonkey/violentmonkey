import { getActiveTab } from '@/common';
import { postInitialize } from './init';
import { commands } from './message';
import { reloadAndSkipScripts } from './preinject';

postInitialize.push(() => {
  browser.commands?.onCommand.addListener((cmd) => {
    if (cmd === 'newScript') {
      commands.OpenEditor();
    } else if (cmd === SKIP_SCRIPTS) {
      getActiveTab().then(reloadAndSkipScripts);
    } else {
      const route = cmd === TAB_SETTINGS ? `#${cmd}` : '';
      commands.TabOpen({ url: `${extensionOptionsPage}${route}` });
    }
  });
});
