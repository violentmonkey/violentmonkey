import { reactive } from 'vue';

export const store = reactive({
  scripts: [],
  frameScripts: [],
  idMap: {},
  commands: [],
  domain: '',
  injectionFailure: null,
  injectable: true,
});

export const mutex = {
  init(delay = 100) {
    this.ready = new Promise(resolve => {
      this.resolve = resolve;
      // pages like Chrome Web Store may forbid injection in main page so we need a timeout
      setTimeout(resolve, delay);
    });
  },
};

export function resetStoredScripts() {
  store.idMap = {};
  store.scripts.length = 0;
  store.frameScripts.length = 0;
}
