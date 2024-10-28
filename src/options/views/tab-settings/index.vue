<template>
  <div ref="$el" class="tab-settings" :data-show-advanced="settings.showAdvanced">
    <h1 v-text="i18n('labelSettings')"></h1>
    <section class="mb-1c">
      <h3 v-text="i18n('optionPopup')"/>
      <settings-popup/>
    </section>
    <section class="mb-1c">
      <h3 v-text="i18n('optionUpdate')"/>
      <div class="ml-2c flex flex-col">
        <label>
          <locale-group i18n-key="labelAutoUpdate">
            <input v-model="settings.autoUpdate" type="number" min=0 max=365 step=1/>
          </locale-group>
        </label>
        <setting-check :name="kUpdateEnabledScriptsOnly"
                       :label="i18n('labelEnabledScriptsOnly')" />
      </div>
      <div class="ml-2c flex flex-col">
        <setting-check name="notifyUpdates" :label="i18n('labelNotifyUpdates')" />
        <setting-check name="notifyUpdatesGlobal" :label="i18n('labelNotifyUpdatesGlobal')"
                       class="ml-2" />
      </div>
    </section>
    <section class="mb-2c">
      <h3 v-text="i18n('labelBackupMaintenance')" :class="{bright: store.isEmpty === 1}"/>
      <vm-import></vm-import>
      <vm-export></vm-export>
      <hr>
      <vm-maintenance/>
    </section>
    <vm-sync></vm-sync>
    <details v-for="(obj, key) in {showAdvanced: settings}" :key :open="obj[key]">
      <summary @click.prevent="obj[key] = !obj[key]">
        <!-- eslint-disable-next-line vue/no-v-text-v-html-on-component -->
        <component v-text="i18n('labelAdvanced')" class="inline-block"
                   :is="obj[key] ? 'h1' : 'h3'"/>
      </summary>
      <section class="mb-1c">
        <h3 v-text="i18n('labelGeneral')"></h3>
        <div>
          <label>
            <locale-group i18n-key="optionUiTheme">
              <select v-for="opt in ['uiTheme']" v-model="settings[opt]" :key="opt">
                <option v-for="(title, value) in items[opt]" :key="value"
                        :value v-text="title" />
              </select>
            </locale-group>
          </label>
        </div>
        <div class="ml-2c flex flex-col">
          <label>
            <span v-text="i18n('labelInjectionMode')"></span>
            <select v-for="opt in ['defaultInjectInto']" v-model="settings[opt]" :key="opt">
              <option v-for="(_, mode) in items[opt]" :key="mode" v-text="mode" />
            </select>
            <a class="ml-1" :href="VM_HOME + 'posts/inject-into-context/'" v-bind="EXTERNAL_LINK_PROPS" v-text="i18n('learnInjectionMode')"/>
          </label>
          <tooltip :content="i18n('labelXhrInjectHint')">
            <setting-check name="xhrInject">
              <locale-group i18n-key="labelXhrInject">
                <code>page</code>
              </locale-group> <ruby v-text="i18n('labelXhrInjectNote')"/>
            </setting-check>
          </tooltip>
          <label v-if="!settings.xhrInject">
            <setting-check name="ffInject"/>
            <tooltip :content="i18n('labelFastFirefoxInjectHint')">
              <locale-group i18n-key="labelFastFirefoxInject">
                <code>page</code>
              </locale-group>
            </tooltip>
          </label>
        </div>
        <div class="flex flex-col">
          <locale-group i18n-key="labelExposeStatus">
            <setting-check v-for="([key, host]) in expose" :key="host"
                           :name="`expose.${key}`" class="ml-2 mr-1c">
              <span v-text="host" />
              <a :href="`https://${host}`" v-bind="EXTERNAL_LINK_PROPS">&nearr;</a>
            </setting-check>
          </locale-group>
        </div>
        <setting-check name="helpForLocalFile" :label="i18n('helpForLocalFile')"/>
      </section>

      <vm-editor />

      <section>
        <h3 v-text="i18n('labelScriptTemplate')"/>
        <p>
          <!-- eslint-disable-next-line vue/no-v-text-v-html-on-component -->
          <component v-for="(str, i) in i18n('descScriptTemplate').split(/<(\S+?)>/)" v-text="str"
                     :key="i" :is="i % 2 ? 'code' : 'span'"
          /> <vm-date-info/><!--DANGER! Using the same line to preserve the space-->
        </p>
        <setting-text :name="kScriptTemplate" has-reset/>
      </section>

      <vm-blacklist />

      <section>
        <h3 v-text="i18n('labelCustomCSS')"/>
        <p v-html="i18n('descCustomCSS')"/>
        <setting-text name="customCSS"/>
      </section>
    </details>
  </div>
</template>

<script>
import { i18n } from '@/common';
import { KNOWN_INJECT_INTO, VM_HOME } from '@/common/consts';
import options from '@/common/options';
import { kScriptTemplate, kUpdateEnabledScriptsOnly } from '@/common/options-defaults';
import { keyboardService } from '@/common/keyboard';
import { EXTERNAL_LINK_PROPS, focusMe, getActiveElement } from '@/common/ui';
import { hookSettingsForUI } from '@/common/ui/util';
import { store } from '@/options/utils';

const items = {
  autoUpdate: value => Math.max(0, Math.min(365, +value || 0)),
  defaultInjectInto: { ...KNOWN_INJECT_INTO },
  showAdvanced: value => value,
  uiTheme: {
    '': i18n('optionUiThemeAuto'),
    dark: i18n('optionUiThemeDark'),
    light: i18n('optionUiThemeLight'),
  },
  xhrInject: value => value,
};
</script>

<script setup>
import { onActivated, onDeactivated, reactive, ref, watch } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import SettingCheck from '@/common/ui/setting-check';
import LocaleGroup from '@/common/ui/locale-group';
import SettingText from '@/common/ui/setting-text';
import SettingsPopup from '@/common/ui/settings-popup.vue';
import VmImport from './vm-import';
import VmExport from './vm-export';
import VmMaintenance from './vm-maintenance';
import VmSync from './vm-sync';
import VmEditor from './vm-editor';
import VmBlacklist from './vm-blacklist';
import VmDateInfo from './vm-date-info';

const $el = ref();
const settings = reactive({});
const expose = ref();
const ctrlS = () => getActiveElement().dispatchEvent(new Event('ctrl-s'));
let revokers;

onActivated(() => {
  focusMe($el.value);
  revokers = [
    keyboardService.register('ctrlcmd-s', ctrlS, { condition: 'inputFocus' }),
    ...hookSettingsForUI(items, settings, watch, 50),
  ];
  expose.value = Object.keys(options.get(EXPOSE)).map(k => [k, decodeURIComponent(k)]);
});

onDeactivated(() => {
  revokers.forEach(r => r());
  revokers = null;
});
</script>

<style>
.tab-settings {
  overflow-y: auto;
  input[type="number"] {
    width: 3.5em;
    padding-left: .25em;
  }
  h1 {
    margin-top: 0;
  }
  summary {
    cursor: pointer;
    margin-left: -1em;
    user-select: none;
    &:focus > *,
    &:hover > * {
      text-decoration: underline;
    }
    h3 {
      margin-top: 0;
    }
  }
  ruby {
    color: var(--fill-8);
  }
  .icon {
    width: 16px;
    height: 16px;
    fill: var(--fg);
  }
}
</style>
