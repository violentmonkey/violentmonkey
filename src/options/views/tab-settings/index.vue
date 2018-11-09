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
    <div class="show-advanced">
      <button @click="showAdvanced = !showAdvanced">
        <span v-text="i18n('labelAdvanced')"></span>
        <icon name="arrow" :class="{ rotate: showAdvanced }" />
      </button>
    </div>
    <div v-show="showAdvanced">
      <section>
        <h3 v-text="i18n('labelEditor')"></h3>
        <div class="mb-1">
          <label>
            <setting-check name="editor.lineWrapping" />
            <span v-text="i18n('labelLineWrapping')"></span>
          </label>
        </div>
        <div class="mb-1">
          <label>
            <span class="mr-1" v-text="i18n('labelIndentUnit')"></span>
            <input type="number" min="1" class="w-1" v-model="indentUnit" />
          </label>
        </div>
      </section>
      <vm-template />
      <vm-blacklist />
      <vm-css />
    </div>
  </div>
</template>

<script>
import { debounce } from '#/common';
import SettingCheck from '#/common/ui/setting-check';
import options from '#/common/options';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmSync from './vm-sync';
import VmTemplate from './vm-template';
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
const settings = {
  showAdvanced: false,
};
items.forEach(({ name }) => {
  settings[name] = null;
});

export default {
  components: {
    Icon,
    VmImport,
    VmExport,
    VmSync,
    VmTemplate,
    VmBlacklist,
    VmCss,
    SettingCheck,
  },
  data() {
    return settings;
  },
  methods: {
    getUpdater({ key, name, normalize }) {
      return (value, oldValue) => {
        if (value !== oldValue) options.set(key || name, normalize(value));
      };
    },
  },
  created() {
    options.ready(() => {
      items.forEach(item => {
        const { name, key, normalize } = item;
        settings[name] = normalize(options.get(key || name));
        hookSetting(key, value => {
          settings[name] = value;
        });
        this.$watch(name, debounce(this.getUpdater(item), 300));
      });
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
.show-advanced {
  margin: 20px 0;
  .rotate {
    transform: rotate(90deg);
  }
}
</style>
