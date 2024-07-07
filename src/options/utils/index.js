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
  sync: [],
  title: null,
});

export const kInclude = 'include';
export const kMatch = 'match';
export const kExclude = 'exclude';
export const kExcludeMatch = 'excludeMatch';
export const kDescription = 'description';
export const kDownloadURL = 'downloadURL';
export const kHomepageURL = 'homepageURL';
export const kIcon = 'icon';
export const kName = 'name';
export const kOrigExclude = 'origExclude';
export const kOrigExcludeMatch = 'origExcludeMatch';
export const kOrigInclude = 'origInclude';
export const kOrigMatch = 'origMatch';
export const kStorageSize = 'storageSize';
export const kUpdateURL = 'updateURL';

export let K_SAVE; // deduced from the current CodeMirror keymap

export function inferSaveHotKey(hotkeys) {
  K_SAVE = hotkeys.find(([, cmd]) => cmd === 'save')?.[0];
  if (!K_SAVE) {
    K_SAVE = 'Ctrl-S';
    hotkeys.unshift([K_SAVE, 'save']);
  }
}

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

export function toggleBoolean(event) {
  const el = /** @type {HTMLTextAreaElement} */ event.target;
  const { selectionStart: start, selectionEnd: end, value } = el;
  // Ignoring double-clicks outside of <textarea>
  const toggled = end && { false: 'true', true: 'false' }[value.slice(start, end)];
  // FF can't run execCommand on textarea, https://bugzil.la/1220696#c24
  if (toggled && !document.execCommand('insertText', false, toggled)) {
    el.value = value.slice(0, start) + toggled + value.slice(end);
    el.setSelectionRange(start + toggled.length, start + toggled.length);
    el.dispatchEvent(new Event('input'));
    el.onblur = () => el.dispatchEvent(new Event('change'));
  }
}
