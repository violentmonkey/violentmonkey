<template>
  <section>
    <h3 v-text="i18n('labelDataImport')" />
    <button v-text="i18n('buttonImportData')" @click="importFile" />
    <button
      :title="i18n('hintVacuum')"
      @click="vacuum"
      :disabled="vacuuming"
      v-text="labelVacuum"
    />
    <div class="mt-1">
      <label>
        <setting-check name="importSettings" />
        <span v-text="i18n('labelImportSettings')"></span>
      </label>
    </div>
  </section>
</template>

<script>
import { i18n, sendMessage } from '#/common';
import options from '#/common/options';
import SettingCheck from '#/common/ui/setting-check';
import { showMessage } from '../../utils';

export default {
  components: {
    SettingCheck,
  },
  data() {
    return {
      vacuuming: false,
      labelVacuum: this.i18n('buttonVacuum'),
    };
  },
  methods: {
    importFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.onchange = () => {
        if (input.files && input.files.length) importData(input.files[0]);
      };
      input.click();
    },
    vacuum() {
      this.vacuuming = true;
      this.labelVacuum = this.i18n('buttonVacuuming');
      sendMessage({ cmd: 'Vacuum' })
      .then(() => {
        this.vacuuming = false;
        this.labelVacuum = this.i18n('buttonVacuumed');
      });
    },
  },
};

function forEachItem(obj, cb) {
  if (obj) {
    Object.keys(obj).forEach((key) => {
      cb(obj[key], key);
    });
  }
}

function getVMConfig(text) {
  let vm;
  try {
    vm = JSON.parse(text);
  } catch (e) {
    console.warn('Error parsing ViolentMonkey configuration.');
  }
  return vm || {};
}

function getVMFile(entry, vmFile) {
  if (!entry.filename.endsWith('.user.js')) return;
  const vm = vmFile || {};
  return new Promise((resolve) => {
    const writer = new zip.TextWriter();
    entry.getData(writer, (text) => {
      const data = { code: text };
      if (vm.scripts) {
        const more = vm.scripts[entry.filename.slice(0, -8)];
        if (more) {
          data.custom = more.custom;
          data.config = more.config || {};
          data.position = more.position;
          // Import data from older version
          if ('enabled' in more) data.config.enabled = more.enabled;
          if ('update' in more) data.config.shouldUpdate = more.update;
        }
      }
      sendMessage({
        cmd: 'ParseScript',
        data,
      })
      .then(() => resolve(true), () => resolve());
    });
  });
}

function getVMFiles(entries) {
  return new Promise((resolve) => {
    const data = { entries };
    const i = entries.findIndex(entry => entry.filename && entry.filename.toLowerCase() === 'violentmonkey');
    if (i < 0) {
      data.vm = {};
      return resolve(data);
    }
    const writer = new zip.TextWriter();
    entries[i].getData(writer, (text) => {
      entries.splice(i, 1);
      data.vm = getVMConfig(text);
      resolve(data);
    });
  });
}

function readZip(file) {
  return new Promise((resolve, reject) => {
    zip.createReader(new zip.BlobReader(file), (res) => {
      res.getEntries((entries) => {
        resolve(entries);
      });
    }, (err) => { reject(err); });
  });
}

function importData(file) {
  readZip(file)
  .then(getVMFiles)
  .then((data) => {
    const { vm, entries } = data;
    if (options.get('importSettings')) {
      const ignoreKeys = ['sync'];
      forEachItem(vm.settings, (value, key) => {
        if (ignoreKeys.includes(key)) return;
        options.set(key, value);
      });
    }
    return Promise.all(entries.map(entry => getVMFile(entry, vm)))
    .then(res => res.filter(Boolean).length)
    .then((count) => {
      forEachItem(vm.values, (valueStore, key) => {
        if (valueStore) {
          sendMessage({
            cmd: 'SetValueStore',
            data: {
              where: { uri: key },
              valueStore,
            },
          });
        }
      });
      showMessage({ text: i18n('msgImported', [count]) });
      sendMessage({ cmd: 'CheckPosition' });
    });
  });
}
</script>
