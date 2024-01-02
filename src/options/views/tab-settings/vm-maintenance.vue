<template>
  <div class="mr-1c">
    <tooltip :content="i18n('hintVacuum')">
      <button @click="vacuum" :disabled="busy" v-text="labelVacuum" />
    </tooltip>
    <button @click="confirmDanger(removeAllScripts, i18nRemoveAllTitle)"
            :disabled="busy || !store.scripts.length"
            v-text="i18n('removeAllScripts')" />
    <button @click="confirmDanger(resetSettings, i18nResetSettings)"
            :disabled="busy"
            :title="resetHint"
            v-text="resetText" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import { i18n, sendCmdDirectly } from '@/common';
import options from '@/common/options';
import defaults from '@/common/options-defaults';
import { deepEqual, mapEntry } from '@/common/object';
import { showConfirmation } from '@/common/ui';
import { markRemove, store } from '../../utils';

const labelVacuum = ref(i18n('buttonVacuum'));
const i18nRemoveAllTitle = i18n('removeAllScriptsConfirm').replace(/\n+/, '\n\n');
const i18nResetSettings = i18n('buttonResetSettings');
const busy = ref(false);
const resetHint = ref('');
const resetText = ref(i18nResetSettings);

function setBusy(val) {
  busy.value = val;
  store.importing = val || null;
}

async function confirmDanger(fn, title) {
  if (!await showConfirmation(title, {ok: {className: 'has-error'}})) {
    return;
  }
  try {
    setBusy(true);
    await fn();
  } finally {
    setBusy(false);
  }
}

async function removeAllScripts() {
  await Promise.all(store.scripts.map(s => markRemove(s, true)));
  store.scripts = []; // nuking the ghosts because the user's intent was already confirmed
}

function resetSettings() {
  const ignoredKeys = [
    'lastModified',
    'lastUpdate',
    'sync',
  ];
  const diff = defaults::mapEntry(null, (key, defVal) => !ignoredKeys.includes(key)
    && !deepEqual(defVal, options.get(key))
    && key);
  resetHint.value = JSON.stringify(diff, null, 2)
    .slice(1, -1).replace(/^\s{2}/gm, '');
  resetText.value = `${i18nResetSettings} (${Object.keys(diff).length})`;
  return sendCmdDirectly('SetOptions', diff);
}

async function vacuum() {
  setBusy(true);
  labelVacuum.value = i18n('buttonVacuuming');
  const { fixes, errors } = await sendCmdDirectly('Vacuum');
  const errorText = errors?.join('\n');
  setBusy(false);
  labelVacuum.value = i18n('buttonVacuumed') + (fixes ? ` (${fixes})` : '');
  if (errorText) {
    showConfirmation(i18n('msgErrorFetchingResource') + '\n\n' + errorText, { cancel: false });
  }
}
</script>
