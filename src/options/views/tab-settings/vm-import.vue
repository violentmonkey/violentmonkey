<template>
  <section>
    <h3 v-text="i18n('labelDataImport')"></h3>
    <button v-text="i18n('buttonImportData')" @click="importFile"></button>
    <button :title="i18n('hintVacuum')" @click="vacuum" :disabled="vacuuming" v-text="labelVacuum"></button>
    <div class="mt-1">
      <label>
        <setting-check name="importSettings" />
        <span v-text="i18n('labelImportSettings')"></span>
      </label>
    </div>
  </section>
</template>

<script>
import { i18n, sendMessage } from 'src/common';
import options from 'src/common/options';
import { showMessage } from '../../utils';
import SettingCheck from '../setting-check';

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
  vm = vm || {};
  forEachItem(vm.values, (value, key) => {
    if (value) {
      sendMessage({
        cmd: 'SetValue',
        data: {
          uri: key,
          values: value,
        },
      });
    }
  });
  if (options.get('importSettings')) {
    const ignoreKeys = ['sync'];
    forEachItem(vm.settings, (value, key) => {
      if (ignoreKeys.includes(key)) return;
      options.set(key, value);
    });
  }
  return vm;
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
          if (more.custom) data.custom = more.custom;
          data.more = more;
          delete more.id;
          delete more.custom;
        }
      }
      sendMessage({
        cmd: 'ParseScript',
        data,
      }).then(() => resolve(true));
    });
  });
}

function getVMFiles(entries) {
  const i = entries.findIndex(entry => entry.filename === 'ViolentMonkey');
  if (i < 0) {
    return { entries };
  }
  return new Promise((resolve) => {
    const writer = new zip.TextWriter();
    entries[i].getData(writer, (text) => {
      entries.splice(i, 1);
      resolve({
        entries,
        vm: getVMConfig(text),
      });
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
    return Promise.all(entries.map(entry => getVMFile(entry, vm)));
  })
  .then(res => res.filter(Boolean).length)
  .then(count => {
    showMessage({ text: i18n('msgImported', [count]) });
    sendMessage({ cmd: 'CheckPosition' });
  });
}
</script>
