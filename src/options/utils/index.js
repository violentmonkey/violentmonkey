import { route } from '#/common/router';
import { isHiDPI } from '#/common/ui/favicon';

export const store = {
  route,
  scripts: [],
  get installedScripts() {
    return store.scripts.filter(script => !script.config.removed);
  },
  get removedScripts() {
    return store.scripts.filter(script => script.config.removed);
  },
  HiDPI: isHiDPI,
};
