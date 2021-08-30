<template>
  <div class="tab-settings mb-1c">
    <h1 class="mt-0" v-text="i18n('labelSettings')"></h1>
    <section class="mb-1c">
      <h3 v-text="i18n('labelGeneral')"></h3>
      <div>
        <setting-check name="autoReload" :label="i18n('labelAutoReloadCurrentTab')" />
      </div>
      <div>
        <setting-check name="editorWindow" class="mr-2" ref="EW">
          <tooltip :content="editorWindowHint" :disabled="!editorWindowHint">
            <span v-text="i18n('optionEditorWindow')"></span>
          </tooltip>
        </setting-check>
        <setting-check name="editorWindowSimple" :label="i18n('optionEditorWindowSimple')"
                       v-show="($refs.EW || {}).value"/>
      </div>
      <div class="ml-2c">
        <label>
          <locale-group i18n-key="labelPopupSort">
            <select v-for="opt in ['filtersPopup.sort']" v-model="settings[opt]" :key="opt">
              <option v-for="(title, value) in items[opt].enum" :key="`${opt}:${value}`"
                      :value="value" v-text="title" />
            </select>
          </locale-group>
        </label>
        <label>
          <select v-for="opt in ['filtersPopup.hideDisabled']" v-model="settings[opt]" :key="opt">
            <option v-for="(title, value) in items[opt].enum" :key="`${opt}:${value}`"
                    :value="value" v-text="title" />
          </select>
        </label>
        <setting-check name="filtersPopup.enabledFirst" :label="i18n('optionPopupEnabledFirst')"
                       v-show="!settings['filtersPopup.hideDisabled']" />
      </div>
      <div class="mr-2c">
        <label>
          <span v-text="i18n('labelBadge')"></span>
          <select v-for="opt in ['showBadge']" v-model="settings[opt]" :key="opt">
            <option v-for="(title, value) in items[opt].enum" :key="`${opt}:${value}`"
                    :value="value" v-text="title" />
          </select>
        </label>
        <label>
          <span v-text="i18n('labelBadgeColors')"/>
          <tooltip v-for="(title, name) in items.badgeColor.enum" :key="`bc:${name}`"
                   :content="title">
            <input type="color" v-model="settings[name]">
          </tooltip>
          <button v-text="i18n('buttonReset')" v-show="isCustomBadgeColor" class="ml-1"
                  @click="onResetBadgeColors"/>
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
    <section class="mb-2c">
      <h3 v-text="i18n('labelBackup')" />
      <vm-import></vm-import>
      <vm-export></vm-export>
    </section>
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
            <select v-for="opt in ['defaultInjectInto']" v-model="settings[opt]" :key="opt">
              <option v-for="(_, mode) in items[opt].enum" :key="`${opt}:${mode}`"
                      :value="mode" v-text="mode" />
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
import { debounce, hasOwnProperty, i18n } from '#/common';
import { INJECT_AUTO, INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import SettingCheck from '#/common/ui/setting-check';
import { forEachEntry, mapEntry } from '#/common/object';
import options from '#/common/options';
import optionsDefaults from '#/common/options-defaults';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import LocaleGroup from '#/common/ui/locale-group';
import loadZip from '#/common/zip';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmSync from './vm-sync';
import VmEditor from './vm-editor';
import VmTemplate from './vm-template';
import VmBlacklist from './vm-blacklist';
import VmCss from './vm-css';

const badgeColorEnum = {
  badgeColor: i18n('titleBadgeColor'),
  badgeColorBlocked: i18n('titleBadgeColorBlocked'),
};
const badgeColorNames = Object.keys(badgeColorEnum);
const badgeColorItem = {
  enum: badgeColorEnum, // exposing to the template
  normalize: (value, name) => (
    /^#[0-9a-f]{6}$/i.test(value) ? value : optionsDefaults[name]
  ),
};
const items = {
  autoUpdate: {
    normalize: value => Math.max(0, Math.min(365, +value || 0)),
  },
  defaultInjectInto: {
    enum: {
      [INJECT_AUTO]: '',
      [INJECT_PAGE]: '',
      [INJECT_CONTENT]: '',
    },
  },
  showBadge: {
    enum: {
      '': i18n('labelBadgeNone'),
      unique: i18n('labelBadgeUnique'),
      total: i18n('labelBadgeTotal'),
    },
  },
  'filtersPopup.hideDisabled': {
    enum: {
      '': i18n('optionPopupShowDisabled'),
      group: i18n('optionPopupGroupDisabled'),
      hide: i18n('optionPopupHideDisabled'),
    },
  },
  'filtersPopup.sort': {
    enum: {
      exec: i18n('filterExecutionOrder'),
      alpha: i18n('filterAlphabeticalOrder'),
    },
  },
};
const normalizeEnum = (value, name) => (
  items[name].enum::hasOwnProperty(value)
    ? value
    : Object.keys(items[name].enum)[0]
);
const getItemUpdater = (name, normalize) => (
  debounce((value, oldValue) => {
    value = normalize(value, name);
    oldValue = normalize(oldValue, name);
    if (value !== oldValue) options.set(name, value);
  }, 300)
);
const settings = items::mapEntry(() => null);
badgeColorNames.forEach(name => {
  items[name] = badgeColorItem;
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
      items,
      settings,
    };
  },
  computed: {
    editorWindowHint() {
      return global.chrome.windows?.onBoundsChanged ? null : this.i18n('optionEditorWindowHint');
    },
    isCustomBadgeColor() {
      return badgeColorNames.some(name => settings[name] !== optionsDefaults[name]);
    },
  },
  methods: {
    onResetBadgeColors() {
      badgeColorNames.forEach(name => {
        settings[name] = optionsDefaults[name];
      });
    },
  },
  created() {
    this.revokers = [];
    items::forEachEntry(([name, { normalize = normalizeEnum }]) => {
      this.revokers.push(hookSetting(name, val => { settings[name] = normalize(val, name); }));
      this.$watch(() => settings[name], getItemUpdater(name, normalize));
    });
    this.expose = Object.keys(options.get('expose')).map(k => [k, decodeURIComponent(k)]);
    // Preload zip.js when user visits settings tab
    loadZip();
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
