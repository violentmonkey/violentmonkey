<template>
  <div class="export flex-1">
    <div class="flex flex-wrap center-items mr-1c">
      <button v-text="i18n('buttonExportData')" @click="handleExport" :disabled="exporting"/>
      <setting-text name="exportNameTemplate" ref="tpl" has-reset :has-save="false" :rows="1"
                    class="tpl flex flex-1 center-items ml-1c"/>
      <vm-date-info/>
      <span hidden v-text="fileName"/>
    </div>
    <div class="mt-1">
      <setting-check name="exportValues" :label="i18n('labelExportScriptData')" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { strToU8, zipSync } from 'fflate';
import { getScriptName, sendCmdDirectly } from '@/common';
import { formatDate } from '@/common/date';
import options from '@/common/options';
import { downloadBlob } from '@/common/download';
import { vmZipEntryName } from '@/options/utils';
import SettingCheck from '@/common/ui/setting-check';
import SettingText from '@/common/ui/setting-text';
import VmDateInfo from './vm-date-info';

const tpl = ref();
const exporting = ref(false);
const fileName = computed(() => {
  const tplComp = tpl.value;
  return tplComp && `${formatDate(tplComp.text.trim() || tplComp.defaultValue)}.zip`;
});

async function handleExport() {
  try {
    exporting.value = true;
    downloadBlob(await exportData(), fileName.value);
  } finally {
    exporting.value = false;
  }
}

function normalizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-');
}

async function exportData() {
  const withValues = options.get('exportValues');
  const { items, values } = await sendCmdDirectly('ExportZip', {
    values: withValues,
  });
  const names = {};
  const vmScripts = {};
  const vmValues = {};
  const vm = {
    scripts: vmScripts,
    settings: options.get(),
  };
  const files = {};
  delete vm.settings.sync;
  if (withValues) vm.values = vmValues;
  for (const { /**@type{VMScript}*/script, code } of items) {
    let name = normalizeFilename(getScriptName(script));
    if (names[name]) {
      names[name] += 1;
      name = `${name}_${names[name]}`;
    } else names[name] = 1;
    const { id, position, uri, lastModified, lastUpdated } = script.props;
    const modDate = lastUpdated || lastModified;
    const info = {
      custom: script.custom,
      config: script.config,
      position,
      lastModified,
      lastUpdated,
    };
    const v = withValues && values[id];
    if (v) {
      // `values` are related to scripts by `props.id` in Violentmonkey,
      // but by the global `props.uri` when exported.
      vmValues[uri] = v;
    }
    vmScripts[name] = info;
    files[`${name}.user.js`] = [
      strToU8(code),
      modDate && { mtime: new Date(modDate) },
    ];
  }
  files[vmZipEntryName] = [strToU8(JSON.stringify(vm, null, 2))]; // prettify to help users diff or view it
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
</script>

<style>
.export {
  .modal-content {
    width: 13rem;
  }
  .tpl {
    max-width: 30em;
    &:focus-within ~ [hidden] {
      display: initial;
    }
    textarea {
      height: auto;
      resize: none;
      white-space: nowrap;
      overflow: hidden;
      min-width: 10em;
    }
    button[disabled] { // Hide a disabled `reset` button
      display: none;
    }
  }
}
</style>
