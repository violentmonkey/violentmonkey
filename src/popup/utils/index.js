import { reactive } from 'vue';
import { isTouch } from '@/common/ui';

export const emptyStore = () => ({
  scripts: [],
  frameScripts: [],
  idMap: {},
  commands: {},
  domain: '',
  injectionFailure: null,
  injectable: true,
});

export const isFullscreenPopup = isTouch
  && innerWidth > screen.availWidth - 200
  && innerHeight > screen.availHeight - 200;

export const store = reactive(emptyStore());
