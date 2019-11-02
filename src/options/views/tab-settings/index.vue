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
      <div class="mb-1">
        <label>
          <span v-text="i18n('labelInjectionMode')"></span>
          <select v-model="defaultInjectInto">
            <option value="page">page</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <a class="ml-1" href="https://violentmonkey.github.io/2018/11/23/inject-into-context/" target="_blank" rel="noopener noreferrer" v-text="i18n('learnInjectionMode')"></a>
      </div>
      <div class="mb-1 multi-opt-row">
        <label>
          <span v-text="i18n('labelPopupSort')"></span>
          <select v-model="popupSort">
            <option value="exec" v-text="i18n('filterExecutionOrder')" />
            <option value="alpha" v-text="i18n('filterAlphabeticalOrder')" />
          </select>
        </label>
        <label>
          <setting-check name="filtersPopup.enabledFirst" />{{i18n('optionPopupEnabledFirst')}}
        </label>
        <label>
          <setting-check name="filtersPopup.hideDisabled" />{{i18n('optionPopupHideDisabled')}}
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
      <vm-editor />
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
import VmEditor from './vm-editor';
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
    name: 'defaultInjectInto',
    normalize(value) {
      return value === 'auto' ? 'auto' : 'page';
    },
  },
  {
    key: 'filtersPopup.sort',
    name: 'popupSort',
    normalize: value => value === 'exec' && value || 'alpha',
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
    VmEditor,
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
    this.revokers = [];
    options.ready.then(() => {
      items.forEach((item) => {
        const { name, key, normalize } = item;
        settings[name] = normalize(options.get(key || name));
        this.revokers.push(hookSetting(key, (value) => {
          settings[name] = value;
        }));
        this.$watch(name, debounce(this.getUpdater(item), 300));
      });
    });
  },
  beforeDestroy() {
    this.revokers.forEach((revoke) => { revoke(); });
  },
};
</script>

<style>
.tab-settings {
  overflow-y: auto;
  .multi-opt-row {
    display: flex;
    align-items: center;
    label {
      margin-right: 1em;
    }
  }
  textarea {
    height: 10em;
  }
}
.show-advanced {
  margin: 20px 0;
  .rotate {
    transform: rotate(-90deg);
  }
}
</style>
