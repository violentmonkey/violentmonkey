<template>
  <div class="tab-settings">
    <h1 v-text="i18n('labelSettings')"></h1>
    <section>
      <h3 v-text="i18n('labelGeneral')"></h3>
      <div class="mb-1">
        <label>
          <setting-check name="autoUpdate" />
          <span v-text="i18n('labelAutoUpdate')"></span>
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
      <div class="mb-1">
        <label>
          <span v-text="i18n('labelBadge')"></span>
          <select v-model="showBadge">
            <option value="" v-text="i18n('labelBadgeNone')" />
            <option value="unique" v-text="i18n('labelBadgeUnique')" />
            <option value="total" v-text="i18n('labelBadgeTotal')" />
          </select>
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
import SettingCheck from 'src/common/ui/setting-check';
import options from 'src/common/options';
import hookSetting from 'src/common/hook-setting';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmSync from './vm-sync';
import VmBlacklist from './vm-blacklist';
import VmCss from './vm-css';

const settings = {
  showBadge: normalizeShowBadge(options.get('showBadge')),
};
hookSetting('showBadge', value => {
  settings.showBadge = normalizeShowBadge(value);
});

function normalizeShowBadge(value) {
  if (!value) return '';
  return value === 'total' ? 'total' : 'unique';
}

export default {
  components: {
    VmImport,
    VmExport,
    VmSync,
    VmBlacklist,
    VmCss,
    SettingCheck,
  },
  data() {
    return settings;
  },
  watch: {
    showBadge(value) {
      options.set('showBadge', value);
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
