<template>
  <div class="tab-settings">
    <h1 v-text="i18n('labelSettings')"></h1>
    <section>
      <h3 v-text="i18n('labelGeneral')"></h3>
      <div class="mb-1">
        <label>
          <setting-check name="autoUpdate" @change="updateAutoUpdate" />
          <span v-text="i18n('labelAutoUpdate')"></span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <setting-check name="showBadge" />
          <span v-text="i18n('labelShowBadge')"></span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <setting-check name="autoReload" />
          <span v-text="i18n('labelAutoReloadCurrentTab')"></span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <setting-check name="notifyUpdates" />
          <span v-text="i18n('labelNotifyUpdates')"></span>
        </label>
      </div>
    </section>
    <vm-import></vm-import>
    <vm-export></vm-export>
    <vm-sync></vm-sync>
    <vm-blacklist></vm-blacklist>
    <vm-css></vm-css>
  </div>
</template>

<script>
import { sendMessage } from 'src/common';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmSync from './vm-sync';
import VmBlacklist from './vm-blacklist';
import VmCss from './vm-css';
import SettingCheck from '../setting-check';

export default {
  components: {
    VmImport,
    VmExport,
    VmSync,
    VmBlacklist,
    VmCss,
    SettingCheck,
  },
  methods: {
    updateAutoUpdate() {
      sendMessage({ cmd: 'AutoUpdate' });
    },
  },
};
</script>

<style>
.tab-settings {
  overflow-y: auto;
  textarea {
    height: 10em;
  }
}
</style>
