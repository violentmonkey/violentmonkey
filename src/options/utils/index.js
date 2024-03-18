import { reactive } from 'vue';
import { sendCmdDirectly } from '@/common';
import { route } from '@/common/router';

export * from './search';

export const store = reactive({
  route,
  /** Speedup and deflicker initial page load by not rendering an invisible script list */
  canRenderScripts: [SCRIPTS, TAB_RECYCLE, ''].includes(route.hash),
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

export function markRemove(script, removed) {
  return sendCmdDirectly('MarkRemoved', {
    id: script.props.id,
    removed,
  });
}

export async function runInBatch(fn, ...args) {
  try {
    store.importing = true;
    await fn(...args);
  } finally {
    store.importing = false;
  }
}
