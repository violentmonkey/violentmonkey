import { reactive } from 'vue';
import { route } from '@/common/router';

export const store = reactive({
  route,
  scripts: [],
  removedScripts: [],
  importing: null,
  loading: false,
  /** Whether removed scripts need to be filtered from `store.scripts`. */
  needRefresh: false,
  storageSize: 0,
  sync: [],
  title: null,
});
