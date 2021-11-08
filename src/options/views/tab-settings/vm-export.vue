<template>
  <div class="export">
    <div class="flex flex-wrap center-items mr-1c">
      <button v-text="i18n('buttonExportData')" @click="handleExport" :disabled="exporting"/>
      <setting-text name="exportNameTemplate" ref="tpl" has-reset :has-save="false" :rows="1"
                    class="tpl flex flex-1 center-items ml-1c"/>
      <tooltip :content="i18n('msgDateFormatInfo', dateTokens)" placement="left">
        <a href="https://momentjs.com/docs/#/displaying/format/" target="_blank">
          <icon name="info"/>
        </a>
      </tooltip>
      <span hidden v-text="getFileName()"/>
    </div>
    <div class="mt-1">
      <setting-check name="exportValues" :label="i18n('labelExportScriptData')" />
    </div>
    <modal
      v-if="store.ffDownload"
      transition="in-out"
      :visible="!!store.ffDownload.url"
      @close="store.ffDownload = {}">
      <div class="modal-content">
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
import Tooltip from 'vueleton/lib/tooltip/bundle';
import Icon from '#/common/ui/icon';
import { getScriptName, sendCmdDirectly } from '#/common';
import { formatDate, DATE_FMT } from '#/common/date';
import { objectGet } from '#/common/object';
import options from '#/common/options';
import ua from '#/common/ua';
import SettingCheck from '#/common/ui/setting-check';
import SettingText from '#/common/ui/setting-text';
import { downloadBlob } from '#/common/download';
import loadZip from '#/common/zip';
import { store } from '../../utils';

/**
 * Note:
 * - Firefox does not support multiline <select>
 */
if (IS_FIREFOX) store.ffDownload = {};

export default {
  components: {
    SettingCheck,
    SettingText,
    Icon,
    Modal,
    Tooltip,
  },
  data() {
    return {
      store,
      dateTokens: Object.keys(DATE_FMT).join(', '),
      exporting: false,
    };
  },
  methods: {
    async handleExport() {
      try {
        this.exporting = true;
        download(await exportData(), this.getFileName());
      } finally {
        this.exporting = false;
      }
    },
    getFileName() {
      const { tpl } = this.$refs;
      return tpl && `${formatDate(tpl.value?.trim() || tpl.defaultValue)}.zip`;
    },
  },
};

function download(blob, fileName) {
  /* Old FF can't download blobs https://bugzil.la/1420419, fixed by enabling OOP:
   * v56 in Windows https://bugzil.la/1357486
   * v61 in MacOS https://bugzil.la/1385403
   * v63 in Linux https://bugzil.la/1357487 */
  const FF = ua.firefox;
  // eslint-disable-next-line no-nested-ternary
  if (FF && (ua.os === 'win' ? FF < 56 : ua.os === 'mac' ? FF < 61 : FF < 63)) {
    const reader = new FileReader();
    reader.onload = () => {
      store.ffDownload = {
        name: fileName,
        url: reader.result,
      };
    };
    reader.readAsDataURL(blob);
  } else {
    downloadBlob(blob, fileName);
  }
}

function normalizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-');
}

async function exportData() {
  const withValues = options.get('exportValues');
  const data = await sendCmdDirectly('ExportZip', {
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
.export {
  .modal-content {
    width: 13rem;
  }
  .icon {
    width: 16px;
    height: 16px;
    fill: var(--fg);
  }
  .tpl {
    max-width: 30em;
    &:focus-within ~ [hidden] {
      display: initial;
    }
    textarea {
      height: auto;
      resize: none;
      white-space: nowrap;
      overflow: hidden;
      min-width: 10em;
    }
    button[disabled] { // Hide a disabled `reset` button
      display: none;
    }
  }
}
</style>
