<template>
  <section>
    <h3 v-text="i18n('labelDataExport')"></h3>
    <div class="export-list">
      <div class="ellipsis" v-for="item in items"
        :class="{active: item.active}"
        @click="item.active = !item.active"
        v-text="item.script.custom.name || item.script.meta.name"></div>
    </div>
    <button v-text="i18n('buttonAllNone')" @click="toggleSelection()"></button>
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

/**
 * Note:
 * - Firefox does not support multiline <select>
 */

export default {
  data() {
    return {
      store,
      exporting: false,
      items: [],
    };
  },
  watch: {
    'store.scripts': 'initItems',
  },
  computed: {
    selectedIds() {
      return this.items.filter(item => item.active).map(item => item.script.id);
    },
  },
  created() {
    this.initItems();
  },
  methods: {
    initItems() {
      this.items = (store.scripts || []).map(script => ({
        script,
        active: true,
      }));
    },
    toggleSelection() {
      if (!store.scripts.length) return;
      const active = this.selectedIds.length < store.scripts.length;
      this.items.forEach(item => { item.active = active; });
    },
    exportData() {
      this.exporting = true;
      Promise.resolve(exportData(this.selectedIds))
      .then(download)
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

function download(blob) {
  // Known issue: does not work on Firefox
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1331176
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style = 'display: none';
  document.body.appendChild(a);
  a.href = url;
  a.download = 'scripts.zip';
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    delete vm.settings.sync;
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
  .then(writer => new Promise((resolve) => {
    writer.close((blob) => {
      resolve(blob);
    });
  }));
}
</script>

<style>
.export-list {
  display: block;
  min-height: 4rem;
  max-height: 20rem;
  overflow-y: auto;
  padding: .3rem;
  white-space: normal;
  border: 1px solid #ddd;
  > .ellipsis {
    display: inline-block;
    width: 13rem;
    max-width: 100%;
    line-height: 1.5;
    margin-right: .2rem;
    margin-bottom: .1rem;
    padding: 0 .3rem;
    box-shadow: 0 0 1px black;
    cursor: pointer;
    &.active {
      background: #3498db;
      color: white;
    }
  }
}
</style>
