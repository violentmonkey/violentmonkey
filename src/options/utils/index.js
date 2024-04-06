import { reactive } from 'vue';
import { sendCmdDirectly } from '@/common';
import { route } from '@/common/router';

export * from './search';

export const store = reactive({
  route,
  batch: null,
  /** Speedup and deflicker initial page load by not rendering an invisible script list */
  canRenderScripts: [SCRIPTS, TAB_RECYCLE, ''].includes(route.hash),
  scripts: [],
  removedScripts: [],
  loading: false,
  /** Whether removed scripts need to be filtered from `store.scripts`. */
  needRefresh: false,
  storageSize: 0,
  sync: [],
  title: null,
});

export const kInclude = 'include';
export const kMatch = 'match';
export const kExclude = 'exclude';
export const kExcludeMatch = 'excludeMatch';

export function markRemove(script, removed) {
  return sendCmdDirectly('MarkRemoved', {
    id: script.props.id,
    removed,
  });
}

export async function runInBatch(fn, ...args) {
  try {
    await (store.batch = fn(...args) || true);
  } finally {
    store.batch = false;
  }
}
