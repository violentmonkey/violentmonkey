<template>
  <div>
    <button v-text="i18n('buttonExportData')" @click="handleExport" :disabled="exporting"></button>
    <div class="mt-1">
      <setting-check name="exportValues" :label="i18n('labelExportScriptData')" />
    </div>
    <modal
      v-if="store.ffDownload"
      transition="in-out"
      :visible="!!store.ffDownload.url"
      @close="store.ffDownload = {}">
      <div class="export-modal modal-content">
        <a :download="store.ffDownload.name" :href="store.ffDownload.url">
          Right click and save as<br />
          <strong>scripts.zip</strong>
        </a>
      </div>
    </modal>
  </div>
</template>

<script>
import Modal from 'vueleton/lib/modal/bundle';
import { getScriptName, sendCmd } from '#/common';
import { objectGet } from '#/common/object';
import options from '#/common/options';
import ua from '#/common/ua';
import SettingCheck from '#/common/ui/setting-check';
import { downloadBlob } from '#/common/download';
import loadZip from '#/common/zip';
import { store } from '../../utils';

/**
 * Note:
 * - Firefox does not support multiline <select>
 */
if (ua.isFirefox) store.ffDownload = {};

export default {
  components: {
    SettingCheck,
    Modal,
  },
  data() {
    return {
      store,
      exporting: false,
    };
  },
  methods: {
    async handleExport() {
      this.exporting = true;
      try {
        const blob = await exportData();
        download(blob);
      } catch (err) {
        console.error(err);
      }
      this.exporting = false;
    },
  },
};

function leftpad(src, length, pad = '0') {
  let str = `${src}`;
  while (str.length < length) str = pad + str;
  return str;
}

function getTimestamp() {
  const date = new Date();
  return `${
    date.getFullYear()
  }-${
    leftpad(date.getMonth() + 1, 2)
  }-${
    leftpad(date.getDate(), 2)
  }_${
    leftpad(date.getHours(), 2)
  }.${
    leftpad(date.getMinutes(), 2)
  }.${
    leftpad(date.getSeconds(), 2)
  }`;
}

function getExportname() {
  return `scripts_${getTimestamp()}.zip`;
}

function download(blob) {
  /* Old FF can't download blobs https://bugzil.la/1420419, fixed by enabling OOP:
   * v56 in Windows https://bugzil.la/1357486
   * v61 in MacOS https://bugzil.la/1385403
   * v63 in Linux https://bugzil.la/1357487 */
  const FF = ua.isFirefox;
  // eslint-disable-next-line no-nested-ternary
  if (FF && (ua.os === 'win' ? FF < 56 : ua.os === 'mac' ? FF < 61 : FF < 63)) {
    const reader = new FileReader();
    reader.onload = () => {
      store.ffDownload = {
        name: getExportname(),
        url: reader.result,
      };
    };
    reader.readAsDataURL(blob);
  } else {
    downloadBlob(blob, getExportname());
  }
}

function normalizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-');
}

async function exportData() {
  const withValues = options.get('exportValues');
  const data = await sendCmd('ExportZip', {
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
    content: JSON.stringify(vm),
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
.export-modal {
  width: 13rem;
}
</style>
