<template>
  <div>
    <button v-text="i18n('buttonImportData')" @click="pickBackup" ref="buttonImport"
            :disabled="store.importing"/>
    <tooltip :content="i18n('hintVacuum')">
      <button @click="vacuum" :disabled="vacuuming" v-text="labelVacuum" />
    </tooltip>
    <div class="mt-1">
      <setting-check name="importScriptData" :label="labelImportScriptData" />
      <br>
      <setting-check name="importSettings" :label="labelImportSettings" />
    </div>
    <table class="import-report">
      <tr v-for="({ type, name, text }, i) in reports" :key="i" :data-type="type">
        <td v-text="name" v-if="name"/>
        <td v-text="text" :colspan="name ? null : 2"/>
      </tr>
    </table>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import { ensureArray, i18n, isEmpty, sendCmdDirectly, trueJoin } from '@/common';
import { RUN_AT_RE } from '@/common/consts';
import options from '@/common/options';
import SettingCheck from '@/common/ui/setting-check';
import loadZipLibrary from '@/common/zip';
import { showConfirmation } from '@/common/ui';
import { store } from '../../utils';

const reports = reactive([]);
const buttonImport = ref();
const vacuuming = ref(false);
const labelImportScriptData = i18n('labelImportScriptData');
const labelImportSettings = i18n('labelImportSettings');
const labelVacuum = ref(i18n('buttonVacuum'));

onMounted(() => {
  const toggleDragDrop = initDragDrop(buttonImport.value);
  addEventListener('hashchange', toggleDragDrop);
  toggleDragDrop();
});

function pickBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = () => importBackup(input.files?.[0]);
  input.click();
}

async function vacuum() {
  vacuuming.value = true;
  labelVacuum.value = i18n('buttonVacuuming');
  const { fixes, errors } = await sendCmdDirectly('Vacuum');
  const errorText = errors?.join('\n');
  vacuuming.value = false;
  labelVacuum.value = i18n('buttonVacuumed') + (fixes ? ` (${fixes})` : '');
  if (errorText) {
    showConfirmation(i18n('msgErrorFetchingResource') + '\n\n' + errorText, { cancel: false });
  }
}

async function importBackup(file) {
  if (!store.importing) {
    try {
      await (store.importing = doImportBackup(file));
    } finally {
      store.importing = null;
    }
  }
}

async function doImportBackup(file) {
  if (!file) return;
  reports.length = 0;
  const importScriptData = options.get('importScriptData');
  const importSettings = options.get('importSettings');
  const zip = await loadZipLibrary();
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const entries = await reader.getEntries().catch(report) || [];
  if (reports.length) return;
  report('', file.name, 'info');
  const uriMap = {};
  const total = entries.reduce((n, entry) => n + entry.filename?.endsWith('.user.js'), 0);
  const vmEntry = entries.find(entry => entry.filename?.toLowerCase() === 'violentmonkey');
  const vm = vmEntry && await readContents(vmEntry) || {};
  const undoPort = chrome.runtime.connect({ name: 'undoImport' });
  const scripts = vm.scripts || {};
  const values = vm.values || {};
  await new Promise(resolveOnUndoMessage);
  await processAll(readScriptOptions, '.options.json');
  await processAll(readScript, '.user.js');
  if (importScriptData) {
    await processAll(readScriptStorage, '.storage.json');
    sendCmdDirectly('SetValueStores', values);
  }
  if (importSettings) {
    sendCmdDirectly('SetOptions',
      toObjectArray(vm.settings, ([key, value]) => key !== 'sync' && { key, value }));
  }
  sendCmdDirectly('CheckPosition');
  await reader.close();
  if (await showConfirmation([
    reportProgress(),
    importScriptData && !isEmpty(values) ? '✔' + labelImportScriptData : '',
    importSettings ? '✔' + labelImportSettings : '',
  ]::trueJoin('\n'), {
    cancel: { text: i18n('buttonUndo'), class: 'has-error' },
  })) {
    undoPort.disconnect();
  } else {
    undoPort.postMessage(true);
    await new Promise(resolveOnUndoMessage);
  }

  function resolveOnUndoMessage(resolve) {
    undoPort.onMessage.addListener(function fn() {
      undoPort.onMessage.removeListener(fn);
      resolve();
    });
  }
  function parseJson(text, entry) {
    try {
      return JSON.parse(text);
    } catch (e) {
      report(e, entry.filename, null);
    }
  }
  function processAll(transform, suffix) {
    return Promise.all(entries.map(async entry => {
      const { filename } = entry;
      if (filename?.endsWith(suffix)) {
        const contents = await readContents(entry);
        return contents && transform(entry, contents, filename.slice(0, -suffix.length));
      }
    }));
  }
  async function readContents(entry) {
    const text = await entry.getData(new zip.TextWriter());
    return entry.filename.endsWith('.js') ? text : parseJson(text, entry);
  }
  async function readScript(entry, code, name) {
    const { filename } = entry;
    const more = scripts[name];
    const data = {
      code,
      ...more && {
        custom: more.custom,
        config: {
          enabled: more.enabled ?? 1, // Import data from older version
          shouldUpdate: more.update ?? 1, // Import data from older version
          ...more.config,
        },
        position: more.position,
        props: {
          lastModified: more.lastModified
            || more.props?.lastModified // Import data from Tampermonkey
            || +entry.lastModDate,
          lastUpdated: more.lastUpdated
            || more.props?.lastUpdated // Import data from Tampermonkey
            || +entry.lastModDate,
        },
      },
    };
    try {
      uriMap[name] = (await sendCmdDirectly('ParseScript', data)).update.props.uri;
      reportProgress(filename);
    } catch (e) {
      report(e, filename, 'script');
    }
  }
  async function readScriptOptions(entry, json, name) {
    const { meta, settings = {}, options: opts } = json;
    if (!meta || !opts) return;
    const ovr = opts.override || {};
    reports[0].text = 'Tampermonkey';
    /** @type {VMScript} */
    scripts[name] = {
      config: {
        enabled: settings.enabled !== false ? 1 : 0,
        shouldUpdate: opts.check_for_updates ? 1 : 0,
      },
      custom: {
        downloadURL: typeof meta.file_url === 'string' ? meta.file_url : undefined,
        noframes: ovr.noframes == null ? undefined : +!!ovr.noframes,
        runAt: RUN_AT_RE.test(opts.run_at) ? opts.run_at : undefined,
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
  async function readScriptStorage(entry, json, name) {
    reports[0].text = 'Tampermonkey';
    values[uriMap[name]] = json.data;
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
  function toObjectArray(obj, transform) {
    return Object.entries(obj || {}).map(transform).filter(Boolean);
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
    // storing it now because `files` will be null after await
    const file = evt.dataTransfer.files[0];
    if (!await showConfirmation(i18n('buttonImportData'))) return;
    await importBackup(file);
  };
  return () => {
    const isSettingsTab = store.route.hash === TAB_SETTINGS;
    const onOff = isSettingsTab ? addEventListener : removeEventListener;
    onOff('dragend', onDragEnd);
    onOff('dragleave', onDragLeave);
    onOff('dragover', onDragOver);
    onOff('drop', onDrop);
  };
}
</script>

<style>
button.drop-allowed {
  background-color: green;
  color: white;
  animation: outline-zoom-in .25s cubic-bezier(0, .5, 0, .75);
}
@keyframes outline-zoom-in {
  from {
    outline: 20px solid rgba(0, 128, 0);
    outline-offset: 200px;
  }
  to {
    outline: 1px solid rgba(0, 128, 0, 0);
    outline-offset: 0;
  }
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
