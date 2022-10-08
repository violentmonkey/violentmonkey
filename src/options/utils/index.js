import { computed, reactive } from 'vue';
import { route } from '@/common/router';
import { isHiDPI } from '@/common/ui/favicon';

export const store = reactive({
  route,
  scripts: [],
  isHiDPI,
  storageSize: 0,
});

export const installedScripts = computed(() => store.scripts.filter(script => !script.config.removed));
export const removedScripts = computed(() => store.scripts.filter(script => script.config.removed));
