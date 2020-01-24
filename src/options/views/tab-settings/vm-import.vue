<template>
  <section>
    <h3 v-text="i18n('labelDataImport')" />
    <button v-text="i18n('buttonImportData')" @click="importFile" ref="buttonImport"/>
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
import { i18n, sendCmd } from '#/common';
import { forEachEntry } from '#/common/object';
import options from '#/common/options';
import SettingCheck from '#/common/ui/setting-check';
import loadZip from '#/common/zip';
import { showConfirmation, showMessage } from '../../utils';

let zip;

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
      input.onchange = () => importData(input.files?.[0]);
      input.click();
    },
    async vacuum() {
      this.vacuuming = true;
      this.labelVacuum = this.i18n('buttonVacuuming');
      await sendCmd('Vacuum');
      this.vacuuming = false;
      this.labelVacuum = this.i18n('buttonVacuumed');
    },
  },
  mounted() {
    const toggleDragDrop = initDragDrop(this.$refs.buttonImport);
    window.addEventListener('hashchange', toggleDragDrop);
    toggleDragDrop();
  },
};

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
          data.props = {
            lastModified: more.lastModified || +entry.lastModDate,
            lastUpdated: more.lastUpdated || +entry.lastModDate,
          };
          // Import data from older version
          if ('enabled' in more) data.config.enabled = more.enabled;
          if ('update' in more) data.config.shouldUpdate = more.update;
        }
      }
      sendCmd('ParseScript', data)
      .then(() => resolve(true), () => resolve());
    });
  });
}

function getVMFiles(entries) {
  return new Promise((resolve) => {
    const data = { entries };
    const i = entries.findIndex(entry => entry.filename?.toLowerCase() === 'violentmonkey');
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
    zip.createReader(
      new zip.BlobReader(file),
      reader => reader.getEntries(resolve),
      reject,
    );
  });
}

async function importData(file) {
  if (!file) return;
  zip = await loadZip();
  const { vm, entries } = await getVMFiles(await readZip(file));
  if (options.get('importSettings')) {
    const ignoreKeys = ['sync'];
    vm.settings::forEachEntry(([key, value]) => {
      if (!ignoreKeys.includes(key)) {
        options.set(key, value);
      }
    });
  }
  const results = await Promise.all(entries.map(entry => getVMFile(entry, vm)));
  const count = results.filter(Boolean).length;
  vm.values::forEachEntry(([uri, valueStore]) => {
    if (valueStore) {
      sendCmd('SetValueStore', { where: { uri }, valueStore });
    }
  });
  showMessage({ text: i18n('msgImported', [count]) });
  sendCmd('CheckPosition');
  zip = null;
}

function initDragDrop(targetElement) {
  let leaveTimer;
  const showAllowedState = state => targetElement.classList.toggle('drop-allowed', state);
  const onDragEnd = () => showAllowedState(false);
  const onDragLeave = () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(onDragEnd, 250);
  };
  const onDragOver = evt => {
    clearTimeout(leaveTimer);
    const hasFiles = evt.dataTransfer.types.includes('Files');
    if (hasFiles) evt.preventDefault();
    showAllowedState(hasFiles);
  };
  const onDrop = async evt => {
    evt.preventDefault();
    showAllowedState(false);
    try {
      // storing it now because `files` will be null after await
      const file = evt.dataTransfer.files[0];
      await showConfirmation(i18n('buttonImportData'));
      targetElement.disabled = true;
      await importData(file);
      targetElement.disabled = false;
    } catch (e) { /* NOP */ }
  };
  return () => {
    const isSettingsTab = window.location.hash === '#settings';
    const onOff = document[`${isSettingsTab ? 'add' : 'remove'}EventListener`];
    document::onOff('dragend', onDragEnd);
    document::onOff('dragleave', onDragLeave);
    document::onOff('dragover', onDragOver);
    document::onOff('drop', onDrop);
  };
}
</script>

<style>
button.drop-allowed {
  background-color: green;
  color: white;
}
</style>
