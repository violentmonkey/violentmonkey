<template>
  <section>
    <h3 v-text="i18n('labelDataExport')"></h3>
    <button v-text="i18n('buttonExportData')" @click="exportData" :disabled="exporting"></button>
    <div class="mt-1">
      <label>
        <setting-check name="exportValues" />
        <span v-text="i18n('labelExportScriptData')"></span>
      </label>
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
  </section>
</template>

<script>
import Modal from 'vueleton/lib/modal/bundle';
import { sendMessage, getLocaleString } from '#/common';
import { objectGet } from '#/common/object';
import options from '#/common/options';
import { isFirefox } from '#/common/ua';
import SettingCheck from '#/common/ui/setting-check';
import { downloadBlob } from '#/common/download';
import { store } from '../../utils';

/**
 * Note:
 * - Firefox does not support multiline <select>
 */
if (isFirefox) store.ffDownload = {};

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
    exportData() {
      this.exporting = true;
      Promise.resolve(exportData())
      .then(download)
      .catch((err) => {
        console.error(err);
      })
      .then(() => {
        this.exporting = false;
      });
    },
    getName(item) {
      return item.script.custom.name || getLocaleString(item.script.meta, 'name');
    },
  },
};

function getWriter() {
  return new Promise((resolve) => {
    zip.createWriter(new zip.BlobWriter(), (writer) => {
      resolve(writer);
    });
  });
}

function addFile(writer, file) {
  return new Promise((resolve) => {
    writer.add(file.name, new zip.TextReader(file.content), () => {
      resolve(writer);
    });
  });
}

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
  // Known issue: does not work on Firefox
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1331176
  if (isFirefox) {
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

function exportData() {
  const withValues = options.get('exportValues');
  return sendMessage({
    cmd: 'ExportZip',
    data: {
      values: withValues,
    },
  })
  .then((data) => {
    const names = {};
    const vm = {
      scripts: {},
      settings: options.get(),
    };
    delete vm.settings.sync;
    if (withValues) vm.values = {};
    const files = (objectGet(data, 'items') || []).map(({ script, code }) => {
      let name = normalizeFilename(script.custom.name || script.meta.name || script.props.id);
      if (names[name]) {
        names[name] += 1;
        name = `${name}_${names[name]}`;
      } else names[name] = 1;
      const info = {
        custom: script.custom,
        config: script.config,
        position: script.props.position,
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
      };
    });
    files.push({
      name: 'violentmonkey',
      content: JSON.stringify(vm),
    });
    return files;
  })
  .then(files => files.reduce((result, file) => (
    result.then(writer => addFile(writer, file))
  ), getWriter()))
  .then(writer => new Promise((resolve) => {
    writer.close((blob) => {
      resolve(blob);
    });
  }));
}
</script>

<style>
.export-modal {
  width: 13rem;
}
</style>
