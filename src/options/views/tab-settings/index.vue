<template>
  <div class="tab-settings mb-1c">
    <h1 class="mt-0" v-text="i18n('labelSettings')"></h1>
    <section class="mb-1c">
      <h3 v-text="i18n('labelGeneral')"></h3>
      <div>
        <setting-check name="autoReload" :label="i18n('labelAutoReloadCurrentTab')" />
      </div>
      <div>
        <setting-check name="editorWindow" class="mr-2">
          <tooltip :content="editorWindowHint" :disabled="!editorWindowHint">
            <span v-text="i18n('optionEditorWindow')"></span>
          </tooltip>
        </setting-check>
        <setting-check name="editorWindowSimple" :label="i18n('optionEditorWindowSimple')" />
      </div>
      <div class="ml-2c">
        <label>
          <locale-group i18n-key="labelPopupSort">
            <select v-model="settings['filtersPopup.sort']">
              <option value="exec" v-text="i18n('filterExecutionOrder')" />
              <option value="alpha" v-text="i18n('filterAlphabeticalOrder')" />
            </select>
          </locale-group>
        </label>
        <setting-check name="filtersPopup.enabledFirst" :label="i18n('optionPopupEnabledFirst')" />
        <setting-check name="filtersPopup.hideDisabled" :label="i18n('optionPopupHideDisabled')" />
      </div>
      <div>
        <label>
          <span v-text="i18n('labelBadge')"></span>
          <select v-model="settings.showBadge">
            <option value="" v-text="i18n('labelBadgeNone')" />
            <option value="unique" v-text="i18n('labelBadgeUnique')" />
            <option value="total" v-text="i18n('labelBadgeTotal')" />
          </select>
        </label>
      </div>
    </section>
    <section class="mb-1c">
      <h3 v-text="i18n('titleScriptUpdated')"/>
      <div>
        <label>
          <locale-group i18n-key="labelAutoUpdate">
            <input v-model="settings.autoUpdate" type="number" min=0 max=365 step=1/>
          </locale-group>
        </label>
      </div>
      <div>
        <setting-check name="notifyUpdates" :label="i18n('labelNotifyUpdates')" />
        <setting-check name="notifyUpdatesGlobal" :label="i18n('labelNotifyUpdatesGlobal')"
                       class="ml-2" />
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
      <section class="mb-1c">
        <h3 v-text="i18n('labelGeneral')"></h3>
        <div>
          <label>
            <span v-text="i18n('labelInjectionMode')"></span>
            <select v-model="settings.defaultInjectInto">
              <option
                v-for="option in injectIntoOptions"
                :key="option"
                :value="option"
                v-text="option"
              />
            </select>
            <a class="ml-1" href="https://violentmonkey.github.io/posts/inject-into-context/" target="_blank" rel="noopener noreferrer" v-text="i18n('learnInjectionMode')"></a>
          </label>
        </div>
        <div>
          <locale-group i18n-key="labelExposeStatus" class="mr-1c">
            <setting-check v-for="([key, host]) in expose" :key="host"
                           :name="`expose.${key}`" class="mr-1c valign-tb">
              <span v-text="host" />
              <a :href="`https://${host}`" target="_blank" rel="noopener noreferrer">&nearr;</a>
            </setting-check>
          </locale-group>
        </div>
      </section>
      <vm-editor />
      <vm-template />
      <vm-blacklist />
      <vm-css />
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { debounce } from '#/common';
import {
  INJECT_AUTO,
  INJECT_PAGE,
  INJECT_CONTENT,
} from '#/common/consts';
import SettingCheck from '#/common/ui/setting-check';
import options from '#/common/options';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import LocaleGroup from '#/common/ui/locale-group';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmSync from './vm-sync';
import VmEditor from './vm-editor';
import VmTemplate from './vm-template';
import VmBlacklist from './vm-blacklist';
import VmCss from './vm-css';

const injectIntoOptions = [
  INJECT_AUTO,
  INJECT_PAGE,
  INJECT_CONTENT,
];
const items = [
  {
    name: 'showBadge',
    normalize(value) {
      if (!value) return '';
      return value === 'total' ? 'total' : 'unique';
    },
  },
  {
    name: 'autoUpdate',
    normalize: value => Math.max(0, Math.min(365, +value || 0)),
  },
  {
    name: 'defaultInjectInto',
    normalize(value) {
      return injectIntoOptions.includes(value) ? value : 'auto';
    },
  },
  {
    name: 'filtersPopup.sort',
    normalize: value => value === 'exec' && value || 'alpha',
  },
];
const settings = {};
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
    LocaleGroup,
    Tooltip,
  },
  data() {
    return {
      showAdvanced: false,
      expose: null,
      settings,
      injectIntoOptions,
    };
  },
  computed: {
    editorWindowHint() {
      return global.chrome.windows?.onBoundsChanged ? null : this.i18n('optionEditorWindowHint');
    },
  },
  methods: {
    getUpdater({ name, normalize }) {
      return (value, oldValue) => {
        value = normalize(value);
        oldValue = normalize(oldValue);
        if (value !== oldValue) options.set(name, value);
      };
    },
  },
  created() {
    this.revokers = [];
    items.forEach((item) => {
      const { name, normalize } = item;
      this.revokers.push(hookSetting(name, val => { settings[name] = normalize(val); }));
      this.$watch(() => settings[name], debounce(this.getUpdater(item), 300));
    });
    this.expose = Object.keys(options.get('expose')).map(k => [k, decodeURIComponent(k)]);
  },
  beforeDestroy() {
    this.revokers.forEach((revoke) => { revoke(); });
  },
};
</script>

<style>
.tab-settings {
  overflow-y: auto;
  label {
    display: inline-block;
    > * {
      vertical-align: middle;
    }
    &.valign-tb * {
      vertical-align: text-bottom;
    }
  }
  textarea {
    height: 10em;
  }
  input[type="number"] {
    width: 3.5em;
    padding-left: .25em;
  }
}
.show-advanced {
  margin: 20px 0;
  .rotate {
    transform: rotate(-90deg);
  }
}
</style>
