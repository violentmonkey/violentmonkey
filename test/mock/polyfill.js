import tldRules from 'tldjs/rules.json';
import { JSDOM } from 'jsdom';

global.window = global;

global.browser = {
  storage: {
    local: {
      get() {
        return Promise.resolve({
          'dat:tldRules': tldRules,
        });
      },
      set() {
        return Promise.resolve();
      },
    },
  },
};

const domProps = Object.getOwnPropertyDescriptors(new JSDOM('').window);
for (const k of Object.keys(domProps)) {
  if (k.endsWith('Storage') || k in global) delete domProps[k];
}
delete domProps.performance;
Object.defineProperties(global, domProps);
