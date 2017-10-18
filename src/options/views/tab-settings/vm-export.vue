<template>
  <section>
    <h3 v-text="i18n('labelDataExport')"></h3>
    <div class="export-list">
      <div class="ellipsis" v-for="item in items"
        :class="{active: item.active}"
        @click="item.active = !item.active"
        v-text="getName(item)">
      </div>
    </div>
    <button v-text="i18n('buttonAllNone')" @click="toggleSelection()"></button>
    <button v-text="i18n('buttonExportData')" @click="exportData" :disabled="exporting"></button>
    <label>
      <setting-check name="exportValues" />
      <span v-text="i18n('labelExportScriptData')"></span>
    </label>
    <vl-modal transition="in-out" :visible="!!store.ffUrl" @close="store.ffUrl = null">
      <div class="export-modal modal-content">
        <a download="scripts.zip" :href="store.ffUrl">
          Right click and save as<br />
          <strong>scripts.zip</strong>
        </a>
      </div>
    </vl-modal>
  </section>
</template>

<script>
import VlModal from 'vueleton/lib/modal';
import { sendMessage, getLocaleString } from 'src/common';
import options from 'src/common/options';
import { isFirefox } from 'src/common/ua';
import SettingCheck from 'src/common/ui/setting-check';
import { store } from '../../utils';

/**
 * Note:
 * - Firefox does not support multiline <select>
 */
if (isFirefox) store.ffUrl = null;

export default {
  components: {
    SettingCheck,
    VlModal,
  },
  data() {
    return {
      isFirefox,
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
      return this.items.filter(item => item.active).map(item => item.script.props.id);
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
      .then(downloadBlob)
      .catch(err => {
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
  return new Promise(resolve => {
    zip.createWriter(new zip.BlobWriter(), writer => {
      resolve(writer);
    });
  });
}

function addFile(writer, file) {
  return new Promise(resolve => {
    writer.add(file.name, new zip.TextReader(file.content), () => {
      resolve(writer);
    });
  });
}

function download(url, cb) {
  const a = document.createElement('a');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.href = url;
  a.download = 'scripts.zip';
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    if (cb) cb();
  });
}

function downloadBlob(blob) {
  // Known issue: does not work on Firefox
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1331176
  if (isFirefox) {
    const reader = new FileReader();
    reader.onload = () => {
      store.ffUrl = reader.result;
    };
    reader.readAsDataURL(blob);
  } else {
    const url = URL.createObjectURL(blob);
    download(url, () => {
      URL.revokeObjectURL(url);
    });
  }
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
  .then(data => {
    const names = {};
    const vm = {
      scripts: {},
      settings: options.get(),
    };
    delete vm.settings.sync;
    if (withValues) vm.values = {};
    const files = data.items.map(({ script, code }) => {
      let name = script.custom.name || script.meta.name || script.props.id;
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
  .then(writer => new Promise(resolve => {
    writer.close(blob => {
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
    border: 1px solid #bbb;
    border-radius: 3px;
    cursor: pointer;
    &.active {
      border-color: #2c82c9;
      background: #3498db;
      color: white;
    }
  }
}
.export-modal {
  width: 13rem;
}
</style>
