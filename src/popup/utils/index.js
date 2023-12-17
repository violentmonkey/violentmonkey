import { reactive } from 'vue';

export const emptyStore = () => ({
  scripts: [],
  frameScripts: [],
  idMap: {},
  commands: {},
  domain: '',
  injectionFailure: null,
  injectable: true,
});

export const store = reactive(emptyStore());
