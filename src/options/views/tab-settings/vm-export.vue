<template>
  <div class="export">
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
    <modal
      v-if="ffDownload"
      transition="in-out"
      :show="!!ffDownload.url"
      @close="ffDownload = {}">
      <div class="modal-content">
        <a :download="ffDownload.name" :href="ffDownload.url">
          Right click and save as<br />
          <strong>scripts.zip</strong>
        </a>
      </div>
    </modal>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import Modal from 'vueleton/lib/modal';
import { ZipWriter, TimestampMode } from 'web-jszipp/browser-legacy/cr61ff58';
import { getScriptName, readBlob, sendCmdDirectly } from '@/common';
import { formatDate } from '@/common/date';
import options from '@/common/options';
import { downloadBlob } from '@/common/download';
import { vmZipEntryName } from '@/options/utils';
import SettingCheck from '@/common/ui/setting-check';
import SettingText from '@/common/ui/setting-text';
import VmDateInfo from './vm-date-info';

/** @type {VMScriptGMInfoPlatform} */
let ua;

const tpl = ref();
const exporting = ref(false);
const ffDownload = ref(IS_FIREFOX && {});
const fileName = computed(() => {
  const tplComp = tpl.value;
  return tplComp && `${formatDate(tplComp.text.trim() || tplComp.defaultValue)}.zip`;
});

async function handleExport() {
  try {
    exporting.value = true;
    if (IS_FIREFOX && !ua) ua = await sendCmdDirectly('UA');
    download(await exportData());
  } finally {
    exporting.value = false;
  }
}

function download(blob) {
  /* Old FF can't download blobs https://bugzil.la/1420419, fixed by enabling OOP:
   * v56 in Windows https://bugzil.la/1357486
   * v61 in MacOS https://bugzil.la/1385403
   * v63 in Linux https://bugzil.la/1357487 */
  // TODO: remove when strict_min_version >= 63
  const FF = IS_FIREFOX && parseFloat(ua.browserVersion);
  const name = fileName.value;
  if (FF && (ua.os === 'win' ? FF < 56 : ua.os === 'mac' ? FF < 61 : FF < 63)) {
    readBlob(blob).then(url => {
      ffDownload.value = {
        name,
        url,
      };
    });
  } else {
    downloadBlob(blob, name);
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
  const writer = new ZipWriter({ outputAs: "blob", timestamps: TimestampMode.Dos | TimestampMode.Unix | TimestampMode.Ntfs });
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
    await writer.add({ path: `${name}.user.js`, data: `${code}`, meta: { modifiedAt: new Date(modDate) } });
  }
  await writer.add({ path: `${vmZipEntryName}`, data: `${JSON.stringify(vm, null, 2)}` }); // prettify to help users diff or view it
  return writer.close();
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
