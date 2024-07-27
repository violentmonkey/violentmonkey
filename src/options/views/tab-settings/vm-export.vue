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
import { getScriptName, sendCmdDirectly } from '@/common';
import { formatDate } from '@/common/date';
import { objectGet } from '@/common/object';
import options from '@/common/options';
import SettingCheck from '@/common/ui/setting-check';
import SettingText from '@/common/ui/setting-text';
import { downloadBlob } from '@/common/download';
import loadZip from '@/common/zip';
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
    const reader = new FileReader();
    reader.onload = () => {
      ffDownload.value = {
        name,
        url: reader.result,
      };
    };
    reader.readAsDataURL(blob);
  } else {
    downloadBlob(blob, name);
  }
}

function normalizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-');
}

async function exportData() {
  const withValues = options.get('exportValues');
  const data = await sendCmdDirectly('ExportZip', {
    values: withValues,
  });
  const names = {};
  const vm = {
    scripts: {},
    settings: options.get(),
  };
  delete vm.settings.sync;
  if (withValues) vm.values = {};
  const files = (objectGet(data, 'items') || []).map(({ script, code }) => {
    let name = normalizeFilename(getScriptName(script));
    if (names[name]) {
      names[name] += 1;
      name = `${name}_${names[name]}`;
    } else names[name] = 1;
    const { lastModified, lastUpdated } = script.props;
    const info = {
      custom: script.custom,
      config: script.config,
      position: script.props.position,
      lastModified,
      lastUpdated,
    };
    if (withValues) {
      // `values` are related to scripts by `props.id` in Violentmonkey,
      // but by the global `props.uri` when exported.
      const values = data.values[script.props.id];
      if (values) vm.values[script.props.uri] = values;
    }
    vm.scripts[name] = info;
    return {
      name: `${name}.user.js`,
      content: code,
      lastModDate: new Date(lastUpdated || lastModified),
    };
  });
  files.push({
    name: 'violentmonkey',
    content: JSON.stringify(vm, null, 2), // prettify to help users diff or view it
  });
  const zip = await loadZip();
  const blobWriter = new zip.BlobWriter('application/zip');
  const writer = new zip.ZipWriter(blobWriter, { bufferedWrite: true, keepOrder: false });
  await Promise.all(files.map(file => writer.add(file.name, new zip.TextReader(file.content), {
    lastModDate: file.lastModDate,
  })));
  const blob = await writer.close();
  return blob;
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
