<template>
  <section>
    <h3 v-text="i18n('labelDataExport')"></h3>
    <select class=export-list multiple v-model="selectedIds">
      <option class="ellipsis" v-for="script in store.scripts"
      :value="script.id" v-text="script.custom.name||script.meta.name"></option>
    </select>
    <button v-text="i18n('buttonAllNone')" @click="updateSelection()"></button>
    <button v-text="i18n('buttonExportData')" @click="exportData" :disabled="exporting"></button>
    <label>
      <input type=checkbox v-setting="'exportValues'">
      <span v-text="i18n('labelExportScriptData')"></span>
    </label>
  </section>
</template>

<script>
import { sendMessage } from 'src/common';
import options from 'src/common/options';
import { store } from '../../utils';

export default {
  data() {
    return {
      store,
      selectedIds: [],
      exporting: false,
    };
  },
  watch: {
    'store.scripts'() {
      this.updateSelection(true);
    },
  },
  created() {
    this.updateSelection(true);
  },
  methods: {
    updateSelection(selectAll) {
      if (!store.scripts.length) return;
      if (selectAll || this.selectedIds.length < store.scripts.length) {
        this.selectedIds = store.scripts.map(script => script.id);
      } else {
        this.selectedIds = [];
      }
    },
    exportData() {
      this.exporting = true;
      Promise.resolve(exportData(this.selectedIds))
      .catch((err) => {
        console.error(err);
      })
      .then(() => {
        this.exporting = false;
      });
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

function download(writer) {
  return new Promise((resolve) => {
    writer.close((blob) => {
      resolve(blob);
    });
  })
  .then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scripts.zip';
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    });
  });
}

function exportData(selectedIds) {
  if (!selectedIds.length) return;
  const withValues = options.get('exportValues');
  return sendMessage({
    cmd: 'ExportZip',
    data: {
      values: withValues,
      ids: selectedIds,
    },
  })
  .then((data) => {
    const names = {};
    const vm = {
      scripts: {},
      settings: options.get(),
    };
    if (withValues) vm.values = {};
    const files = data.scripts.map((script) => {
      let name = script.custom.name || script.meta.name || 'Noname';
      if (names[name]) {
        names[name] += 1;
        name = `${name}_${names[name]}`;
      } else names[name] = 1;
      vm.scripts[name] = ['custom', 'enabled', 'update', 'position']
      .reduce((res, key) => {
        res[key] = script[key];
        return res;
      }, {});
      if (withValues) {
        const values = data.values[script.uri];
        if (values) vm.values[script.uri] = values;
      }
      return {
        name: `${name}.user.js`,
        content: script.code,
      };
    });
    files.push({
      name: 'ViolentMonkey',
      content: JSON.stringify(vm),
    });
    return files;
  })
  .then(files => files.reduce((result, file) => (
    result.then(writer => addFile(writer, file))
  ), getWriter()))
  .then(download);
}
</script>
