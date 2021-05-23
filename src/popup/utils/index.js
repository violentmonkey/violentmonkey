export const store = {
  scripts: [],
  frameScripts: [],
  scriptIds: [],
  commands: [],
  domain: '',
  injectionFailure: null,
  injectable: true,
  blacklisted: false,
};

export const mutex = {
  init(delay = 100) {
    this.ready = new Promise(resolve => {
      this.resolve = resolve;
      // pages like Chrome Web Store may forbid injection in main page so we need a timeout
      setTimeout(resolve, delay);
    });
  },
};
