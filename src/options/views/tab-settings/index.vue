<template>
  <div class="content tab-settings">
    <h1 v-text="i18n('labelSettings')"></h1>
    <section>
      <h3 v-text="i18n('labelGeneral')"></h3>
      <div class="mb-1">
        <label>
          <input type=checkbox v-setting="'autoUpdate'" @change="updateAutoUpdate">
          <span v-text="i18n('labelAutoUpdate')"></span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <input type=checkbox v-setting="'showBadge'">
          <span v-text="i18n('labelShowBadge')"></span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <input type=checkbox v-setting="'ignoreGrant'">
          <span v-text="i18n('labelIgnoreGrant')"></span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <input type=checkbox v-setting="'autoReload'">
          <span v-text="i18n('labelAutoReloadCurrentTab')"></span>
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

export default {
  components: {
    VmImport,
    VmExport,
    VmSync,
    VmBlacklist,
    VmCss,
  },
  methods: {
    updateAutoUpdate() {
      sendMessage({ cmd: 'AutoUpdate' });
    },
  },
};
</script>
