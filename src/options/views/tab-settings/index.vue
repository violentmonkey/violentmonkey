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
    <div>Advanced <icon name="arrow" /></div>
    <section>
      <h3>Editor</h3>
      <div class="mb-1">
        <label>
          <setting-check name="editor.lineWrapping" />
          <span>Line wrapping</span>
        </label>
      </div>
      <div class="mb-1">
        <label>
          <span class="mr-1">Indent unit:</span>
          <input type="number" min="1" class="w-1" v-model="indentUnit" />
        </label>
      </div>
    </section>
    <vm-blacklist></vm-blacklist>
    <vm-css></vm-css>
  </div>
</template>

<script>
import { debounce } from 'src/common';
import SettingCheck from 'src/common/ui/setting-check';
import options from 'src/common/options';
import hookSetting from 'src/common/hook-setting';
import Icon from 'src/common/ui/icon';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmSync from './vm-sync';
import VmBlacklist from './vm-blacklist';
import VmCss from './vm-css';

const items = [
  {
    name: 'showBadge',
    normalize(value) {
      if (!value) return '';
      return value === 'total' ? 'total' : 'unique';
    },
  },
  {
    name: 'indentUnit',
    key: 'editor.indentUnit',
    normalize(value) {
      return +value || 2;
    },
  },
];
const settings = {};
items.forEach(({ name, key, normalize }) => {
  settings[name] = normalize(options.get(key || name));
  hookSetting(key, value => {
    settings[name] = value;
  });
});

export default {
  components: {
    Icon,
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
  methods: {
    getUpdater({ key, normalize }) {
      return (value, oldValue) => {
        if (value !== oldValue) options.set(key, normalize(value));
      };
    },
  },
  created() {
    items.forEach(item => {
      this.$watch(item.name, debounce(this.getUpdater(item), 300));
    });
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
