<template>
  <section>
    <h3 v-text="i18n('labelDataImport')" />
    <button v-text="i18n('buttonImportData')" @click="pickBackup" ref="buttonImport"/>
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
    <table class="import-report">
      <tr v-for="({ type, name, text }, i) in reports" :key="i" :data-type="type">
        <td v-text="name" v-if="name"/>
        <td v-text="text" :colspan="name ? null : 2"/>
      </tr>
    </table>
  </section>
</template>

<script>
import { ensureArray, i18n, sendCmd } from '#/common';
import options from '#/common/options';
import SettingCheck from '#/common/ui/setting-check';
import loadZipLibrary from '#/common/zip';
import { showConfirmation, showMessage } from '../../utils';

const reports = [];

export default {
  components: {
    SettingCheck,
  },
  data() {
    return {
      reports,
      vacuuming: false,
      labelVacuum: this.i18n('buttonVacuum'),
    };
  },
  methods: {
    pickBackup() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.onchange = () => importBackup(input.files?.[0]);
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

async function importBackup(file) {
  if (!file) return;
  reports.length = 0;
  const USERJS_SUFFIX = '.user.js';
  const TM_OPTIONS_SUFFIX = '.options.json';
  const TM_STORAGE_SUFFIX = '.storage.json';
  const zip = await loadZipLibrary();
  const entries = await getAllEntries().catch(report) || [];
  if (reports.length) return;
  report('', file.name, 'info');
  const uriMap = {};
  const total = entries.filter(entry => entry.filename?.endsWith(USERJS_SUFFIX)).length;
  const vm = await readJsonEntry(findEntry('violentmonkey')) || {};
  if (!vm.scripts) vm.scripts = {};
  if (!vm.values) vm.values = {};
  await processAll(readTamperOptsEntry);
  await processAll(readScriptEntry);
  await processAll(readTamperStoreEntry);
  if (options.get('importSettings')) {
    sendCmd('SetOptions',
      objectToArray(vm.settings, ([key, value]) => key !== 'sync' && { key, value }));
  }
  sendCmd('SetValueStores',
    objectToArray(vm.values, ([uri, store]) => store && ({ where: { uri }, store })));
  sendCmd('CheckPosition');
  showMessage({ text: reportProgress() });

  function findEntry(lowerName) {
    return entries.find(_ => _.filename?.toLowerCase() === lowerName);
  }
  function getAllEntries() {
    return new Promise((resolve, reject) => {
      zip.createReader(new zip.BlobReader(file),
        reader => reader.getEntries(resolve),
        reject);
    });
  }
  function objectToArray(obj, transform) {
    return Object.entries(obj || {}).map(transform).filter(Boolean);
  }
  function parseJson(text, name) {
    try {
      return JSON.parse(text);
    } catch (e) {
      report(e, name, null);
    }
  }
  function processAll(transform) {
    return Promise.all(entries.map(transform));
  }
  function readJsonEntry(entry) {
    return entry && new Promise(resolve => {
      entry.getData(new zip.TextWriter(),
        text => resolve(parseJson(text, entry.filename)));
    });
  }
  function readScriptEntry(entry) {
    const { filename } = entry;
    return filename.endsWith(USERJS_SUFFIX) && new Promise((resolve) => {
      entry.getData(new zip.TextWriter(), async (text) => {
        const data = { code: text };
        const name = filename.slice(0, -USERJS_SUFFIX.length);
        const more = vm.scripts[name];
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
        try {
          uriMap[name] = (await sendCmd('ParseScript', data)).update.props.uri;
          reportProgress(filename);
        } catch (e) {
          report(e, filename, 'script');
        }
        resolve();
      });
    });
  }
  async function readTamperOptsEntry(entry) {
    const { filename } = entry;
    const {
      meta,
      settings = {},
      options: opts,
    } = filename?.endsWith(TM_OPTIONS_SUFFIX) && await readJsonEntry(entry) || {};
    if (!meta || !opts) return;
    const ovr = opts.override || {};
    reports[0].text = `Tampermonkey${TM_OPTIONS_SUFFIX}`;
    /** @type VMScript */
    vm.scripts[filename.slice(0, -TM_OPTIONS_SUFFIX.length)] = {
      config: {
        enabled: settings.enabled !== false ? 1 : 0,
        shouldUpdate: opts.check_for_updates ? 1 : 0,
      },
      custom: {
        downloadURL: typeof meta.file_url === 'string' ? meta.file_url : undefined,
        // customizing of @noframes isn't implemented yet
        noframes: !!ovr.noframes || (ovr.noframes == null ? undefined : false),
        runAt: /^document-(start|end|idle)$/.test(opts.run_at) ? opts.run_at : undefined,
        exclude: toStringArray(ovr.use_excludes),
        include: toStringArray(ovr.use_includes),
        match: toStringArray(ovr.use_matches),
        origExclude: ovr.merge_excludes !== false, // will also set to true if absent
        origInclude: ovr.merge_includes !== false,
        origMatch: ovr.merge_matches !== false,
      },
      position: +settings.position || undefined,
      props: {
        lastModified: +meta.modified,
        lastUpdated: +meta.modified,
      },
    };
  }
  async function readTamperStoreEntry(entry) {
    const { filename } = entry;
    if (filename?.endsWith(TM_STORAGE_SUFFIX)) {
      reports[0].text = `Tampermonkey${TM_STORAGE_SUFFIX}`;
      const name = filename.slice(0, -TM_STORAGE_SUFFIX.length);
      const uri = uriMap[name];
      const { data } = uri && await readJsonEntry(entry) || {};
      if (data) vm.values[uri] = data;
    }
  }
  function report(text, name, type = 'critical') {
    reports.push({ text, name, type });
  }
  function reportProgress(filename = '') {
    const count = Object.keys(uriMap).length;
    const text = i18n('msgImported', [count === total ? count : `${count} / ${total}`]);
    reports[0].name = text; // keeping the message in the first column so it doesn't jump around
    reports[0].text = filename;
    return text;
  }
  function toStringArray(data) {
    return ensureArray(data).filter(item => typeof item === 'string');
  }
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
      await importBackup(file);
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
.import-report {
  white-space: pre-wrap;
  padding-top: 1rem;
  font-size: 90%;
  color: #c80;
  &:empty {
    display: none;
  }
  td {
    padding: 1px .5em 3px;
    vertical-align: top; // in case of super long multiline text
  }
  [data-type="critical"] {
    color: #fff;
    background-color: red;
    font-weight: bold;
  }
  [data-type="script"] {
    color: red;
  }
  [data-type="info"] {
    color: blue;
  }
  @media (prefers-color-scheme: dark) {
    color: #a83;
    [data-type="info"] {
      color: #fff;
    }
  }
}
</style>
