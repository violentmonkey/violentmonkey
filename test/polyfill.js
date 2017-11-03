import tldRules from 'tldjs/rules.json';

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
