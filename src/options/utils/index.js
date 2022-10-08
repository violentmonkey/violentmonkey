import { reactive } from 'vue';
import { route } from '@/common/router';

export const store = reactive({
  route,
  scripts: [],
  removedScripts: [],
  storageSize: 0,
});
