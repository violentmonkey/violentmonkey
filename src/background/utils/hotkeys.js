import { postInitialize } from './init';
import { commands } from './message';

postInitialize.push(() => {
  browser.commands.onCommand.addListener((cmd) => {
    if (cmd === 'newScript') {
      commands.OpenEditor();
    } else {
      const route = cmd === 'settings' ? `#${cmd}` : '';
      commands.TabOpen({ url: `/options/index.html${route}` });
    }
  });
});
